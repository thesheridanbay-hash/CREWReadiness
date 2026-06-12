import { sql } from "drizzle-orm";
import type { z } from "zod";

import { AppActionError } from "@/lib/errors";

import { DirectAdapter } from "./adapters/direct";
import { McpAdapter } from "./adapters/mcp";
import type { ProviderAdapter } from "./adapters/types";
import { decryptSecret } from "./crypto";
import { createLeakGuard } from "./guard";
import { recordUsage } from "./meter";
import {
  buildLessonPrompt,
  buildPhotoPrompt,
  buildReteachPrompt,
  buildVariantPrompt,
} from "./prompts";
import {
  AI_TIMEOUTS,
  lessonDraftSchema,
  photoAnalysisSchema,
  variantBatchSchema,
  ZERO_USAGE,
  type AiContext,
  type LessonDraft,
  type PhotoAnalysis,
  type VariantDraft,
} from "./types";

/**
 * AI gateway (T4 — D5): the ONLY module app code may import for AI calls.
 * App code never touches a provider directly.
 *
 * Every operation: resolve the active provider (admin toggle) → delimited
 * prompt → adapter call with timeout → zod-validate → retry once on invalid
 * output → meter usage per company. Callers (Inngest jobs) dead-letter +
 * notify on final failure (D6/D15).
 */

type ResolvedProvider = {
  adapter: ProviderAdapter;
  providerName: string;
  alertThresholdUsd: number | null;
};

const resolveProvider = async (ctx: AiContext): Promise<ResolvedProvider> => {
  const result = await ctx.tx.execute<{
    provider: string | null;
    encrypted_key: string | null;
    settings: Record<string, unknown> | null;
    alert_threshold_usd: string | null;
  }>(sql`SELECT * FROM app_get_active_provider()`);

  const row = result.rows[0];

  if (!row?.provider) {
    throw new AppActionError(
      "conflict",
      "No AI provider is configured. The platform owner sets one in provider settings."
    );
  }

  const settings = row.settings ?? {};
  // Keys are stored AES-256-GCM encrypted (lib/ai/crypto). Decrypt with
  // PROVIDER_KEY_SECRET; a malformed/again-unconfigured value yields an empty
  // key, surfaced to the caller as a provider error rather than a crash.
  let apiKey = "";
  if (row.encrypted_key) {
    try {
      apiKey = decryptSecret(row.encrypted_key);
    } catch {
      throw new AppActionError(
        "conflict",
        "The stored AI provider key could not be decrypted. Re-save it in platform settings."
      );
    }
  }
  const alertThresholdUsd = row.alert_threshold_usd
    ? Number(row.alert_threshold_usd)
    : null;

  if (row.provider === "openclaw") {
    return {
      providerName: "openclaw",
      alertThresholdUsd,
      adapter: new McpAdapter({
        endpoint: String(settings.endpoint ?? ""),
        apiKey,
        toolName: String(settings.toolName ?? "ask_ai_hassan"),
        model: settings.model ? String(settings.model) : undefined,
        thinking: settings.thinking ? String(settings.thinking) : undefined,
        timeoutSeconds:
          typeof settings.timeoutSeconds === "number"
            ? settings.timeoutSeconds
            : 120,
      }),
    };
  }

  return {
    providerName: "direct",
    alertThresholdUsd,
    adapter: new DirectAdapter({
      baseUrl: String(settings.baseUrl ?? "https://api.openai.com/v1"),
      model: String(settings.model ?? "gpt-4o-mini"),
      apiKey,
    }),
  };
};

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AppActionError("conflict", `${label} timed out.`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Validate adapter JSON against a schema; retry once on INVALID OUTPUT only
 * (D15). Timeouts re-throw immediately (review finding #2): a timed-out
 * provider won't produce valid output on a retry, and a second full timeout
 * budget would hold the tenant transaction open for twice as long.
 */
const validated = async <T>(
  schema: z.ZodType<T>,
  call: () => Promise<{ content: unknown; usage: typeof ZERO_USAGE }>,
  timeoutMs: number,
  label: string
): Promise<{ data: T; usage: typeof ZERO_USAGE }> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let result;

    try {
      result = await withTimeout(call(), timeoutMs, label);
    } catch (error) {
      if (error instanceof AppActionError) throw error; // timeout — no retry
      lastError = error; // transport/parse error — one retry is reasonable
      continue;
    }

    const parsed = schema.safeParse(result.content);

    if (parsed.success) return { data: parsed.data, usage: result.usage };

    lastError = parsed.error;
  }

  throw new AppActionError(
    "conflict",
    `${label}: provider returned invalid output twice. ${String(lastError)}`
  );
};

/* ─────────────────────────── Operations ─────────────────────────── */

export const generateLesson = async (
  ctx: AiContext,
  sourceText: string
): Promise<LessonDraft> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveProvider(ctx);

  const { data, usage } = await validated(
    lessonDraftSchema,
    () => adapter.generateJson({ prompt: buildLessonPrompt(sourceText) }),
    AI_TIMEOUTS.generateLesson,
    "generateLesson"
  );

  await recordUsage(ctx, "generateLesson", providerName, usage, alertThresholdUsd);

  return data;
};

export const generateVariants = async (
  ctx: AiContext,
  args: { question: string; explanation: string; count: number }
): Promise<VariantDraft[]> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveProvider(ctx);

  const { data, usage } = await validated(
    variantBatchSchema,
    () => adapter.generateJson({ prompt: buildVariantPrompt(args) }),
    AI_TIMEOUTS.generateVariants,
    "generateVariants"
  );

  await recordUsage(
    ctx,
    "generateVariants",
    providerName,
    usage,
    alertThresholdUsd
  );

  return data;
};

export const analyzePhoto = async (
  ctx: AiContext,
  args: { imageUrl: string; ownerNote: string }
): Promise<PhotoAnalysis> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveProvider(ctx);

  const { data, usage } = await validated(
    photoAnalysisSchema,
    () =>
      adapter.generateJson({
        prompt: buildPhotoPrompt(args.ownerNote),
        imageUrl: args.imageUrl,
      }),
    AI_TIMEOUTS.analyzePhoto,
    "analyzePhoto"
  );

  await recordUsage(ctx, "analyzePhoto", providerName, usage, alertThresholdUsd);

  return data;
};

export const transcribeVoice = async (
  ctx: AiContext,
  audioUrl: string
): Promise<string> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveProvider(ctx);

  const { text, usage } = await withTimeout(
    adapter.transcribe(audioUrl),
    AI_TIMEOUTS.transcribeVoice,
    "transcribeVoice"
  );

  await recordUsage(
    ctx,
    "transcribeVoice",
    providerName,
    usage,
    alertThresholdUsd
  );

  return text;
};

export type ReteachResult =
  | { kind: "stream"; stream: AsyncIterable<string> }
  | { kind: "fallback"; reason: "timeout" | "leak_guard" | "provider_error" };

/** Reteach is capped at ~60 words (prompt) — 256 tokens is generous headroom. */
const RETEACH_MAX_TOKENS = 256;

/**
 * Live reteach (D7): streamed, leak-guarded. Any failure mode — timeout,
 * guard trip, provider error — resolves to a FALLBACK signal; the caller
 * serves a pre-generated variant instead. The learner never stalls.
 *
 * Hardening (review findings #3/#4/#5):
 * - Unguardable answer sets (empty, or any answer too short to detect after
 *   normalization) never stream at all — straight to the variant fallback.
 * - A wall-clock deadline caps TOTAL streaming time, not just connection
 *   time; slow token drips abort at the budget.
 * - Usage is metered UPFRONT inside the caller's still-open transaction.
 *   The stream closure performs NO database writes: it outlives the scoped
 *   transaction, and writing through a closed tx could escape tenant
 *   context. Cost: reteach output is metered as the max token budget rather
 *   than actual tokens (bounded overcount, refined in P3).
 */
export const reteach = async (
  ctx: AiContext,
  args: { question: string; correctAnswers: string[] }
): Promise<ReteachResult> => {
  const guardable =
    args.correctAnswers.length > 0 &&
    args.correctAnswers.every(
      (answer) =>
        answer.replace(/[^\p{L}\p{N}]+/gu, "").length >= 3
    );

  if (!guardable) {
    return { kind: "fallback", reason: "leak_guard" };
  }

  let resolved: ResolvedProvider;

  try {
    resolved = await resolveProvider(ctx);
  } catch {
    return { kind: "fallback", reason: "provider_error" };
  }

  const { adapter, providerName, alertThresholdUsd } = resolved;
  const guard = createLeakGuard(args.correctAnswers);
  const controller = new AbortController();
  const deadline = Date.now() + AI_TIMEOUTS.reteach;

  // Pull the FIRST chunk under the deadline. A non-streaming provider (e.g.
  // the OpenClaw MCP bridge) blocks here until its single reply is ready, so
  // racing next() against the timeout is what actually bounds the learner's
  // wait — a chunk-loop deadline check never runs until a chunk arrives.
  // On timeout we abort the upstream fetch and fall back to a variant (D7).
  let iterator: AsyncIterator<string>;
  let firstResult: IteratorResult<string>;

  try {
    const source = await adapter.streamText({
      prompt: buildReteachPrompt({ question: args.question }),
      maxOutputTokens: RETEACH_MAX_TOKENS,
      signal: controller.signal,
    });
    iterator = source[Symbol.asyncIterator]();
    firstResult = await withTimeout(
      iterator.next(),
      AI_TIMEOUTS.reteach,
      "reteach"
    );
  } catch {
    controller.abort();
    return { kind: "fallback", reason: "timeout" };
  }

  // Meter now, while the caller's transaction is open (finding #5).
  await recordUsage(
    ctx,
    "reteach",
    providerName,
    { ...ZERO_USAGE, outputTokens: RETEACH_MAX_TOKENS },
    alertThresholdUsd
  );

  async function* guarded(): AsyncIterable<string> {
    let result = firstResult;
    while (!result.done) {
      if (Date.now() > deadline) {
        controller.abort();
        return;
      }

      const safe = guard.push(result.value);
      if (safe === null) {
        controller.abort();
        return;
      }
      if (safe) yield safe;

      result = await iterator.next();
    }

    const tail = guard.flush();
    if (tail) yield tail;
  }

  return { kind: "stream", stream: guarded() };
};
