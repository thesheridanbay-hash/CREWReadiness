import { sql } from "drizzle-orm";
import type { z } from "zod";

import { AppActionError } from "@/lib/errors";

import { DirectAdapter } from "./adapters/direct";
import { OpenAiImageAdapter } from "./adapters/image";
import { McpAdapter } from "./adapters/mcp";
import { McpImageAdapter } from "./adapters/mcp-image";
import { McpTtsAdapter } from "./adapters/mcp-tts";
import type {
  ImageProviderAdapter,
  ProviderAdapter,
  TtsProviderAdapter,
} from "./adapters/types";
import { decryptSecret } from "./crypto";
import { createLeakGuard } from "./guard";
import { recordUsage } from "./meter";
import { composeCourseGuidance } from "./prompt-composer";
import {
  buildCoursePrompt,
  buildImagePrompt,
  buildLessonPrompt,
  buildPhotoPrompt,
  buildReteachPrompt,
  buildTranslatePrompt,
  buildVariantPrompt,
  type CourseBrief,
} from "./prompts";
import {
  AI_TIMEOUTS,
  buildLessonTranslationSchema,
  courseDraftSchema,
  lessonDraftSchema,
  photoAnalysisSchema,
  variantBatchSchema,
  ZERO_USAGE,
  type AiContext,
  type CourseDraft,
  type ImageResult,
  type LessonDraft,
  type LessonTranslationResult,
  type PhotoAnalysis,
  type TranslationSource,
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

type ResolvedImageProvider = {
  adapter: ImageProviderAdapter;
  providerName: string;
  alertThresholdUsd: number | null;
};

/**
 * Resolve the IMAGE provider (AI Course Builder). Separate from the text model
 * (the OpenClaw bridge can't do images): its config lives in its own
 * provider_settings row, read here through app_get_image_provider() so tenant
 * asset-generation jobs reach exactly that one row without opening the
 * platform-scoped table.
 */
/**
 * Build an image provider backed by the OpenClaw MCP `generate_image` tool,
 * reusing the active OpenClaw connection (endpoint + key) — no separate key.
 * Only valid when OpenClaw is the active provider.
 */
const buildOpenClawImageProvider = async (
  ctx: AiContext,
  alertOverride: number | null
): Promise<ResolvedImageProvider> => {
  const result = await ctx.tx.execute<{
    provider: string | null;
    encrypted_key: string | null;
    settings: Record<string, unknown> | null;
    alert_threshold_usd: string | null;
  }>(sql`SELECT * FROM app_get_active_provider()`);
  const row = result.rows[0];

  if (row?.provider !== "openclaw") {
    throw new AppActionError(
      "conflict",
      "No image provider is configured. Connect an image model in provider settings, or set OpenClaw as the active provider to use its image tool."
    );
  }

  const settings = row.settings ?? {};
  let apiKey = "";
  if (row.encrypted_key) {
    try {
      apiKey = decryptSecret(row.encrypted_key);
    } catch {
      throw new AppActionError(
        "conflict",
        "The stored OpenClaw key could not be decrypted. Re-save it in platform settings."
      );
    }
  }

  return {
    providerName: "openclaw-image",
    alertThresholdUsd:
      alertOverride ?? (row.alert_threshold_usd ? Number(row.alert_threshold_usd) : null),
    adapter: new McpImageAdapter({
      endpoint: String(settings.endpoint ?? ""),
      apiKey,
      toolName: "generate_image",
      model: settings.imageModel ? String(settings.imageModel) : undefined,
      // Generation lands ~120s+; give the bridge real headroom (well under the
      // 300s route cap) so it doesn't abort a valid image early.
      timeoutSeconds: 270,
    }),
  };
};

const resolveImageProvider = async (
  ctx: AiContext
): Promise<ResolvedImageProvider> => {
  const result = await ctx.tx.execute<{
    provider: string | null;
    encrypted_key: string | null;
    settings: Record<string, unknown> | null;
    alert_threshold_usd: string | null;
  }>(sql`SELECT * FROM app_get_image_provider()`);

  const row = result.rows[0];

  // No dedicated image row → if OpenClaw is the active model, use its image
  // tool automatically (zero config, no separate key).
  if (!row?.provider) {
    return buildOpenClawImageProvider(ctx, null);
  }

  const settings = row.settings ?? {};
  const alertThresholdUsd = row.alert_threshold_usd
    ? Number(row.alert_threshold_usd)
    : null;

  // Dedicated image row can opt into OpenClaw explicitly.
  if (settings.kind === "openclaw") {
    return buildOpenClawImageProvider(ctx, alertThresholdUsd);
  }

  // Otherwise an OpenAI-compatible images endpoint.
  let apiKey = "";
  if (row.encrypted_key) {
    try {
      apiKey = decryptSecret(row.encrypted_key);
    } catch {
      throw new AppActionError(
        "conflict",
        "The stored image provider key could not be decrypted. Re-save it in platform settings."
      );
    }
  }

  return {
    providerName: "image",
    alertThresholdUsd,
    adapter: new OpenAiImageAdapter({
      baseUrl: String(settings.baseUrl ?? settings.endpoint ?? ""),
      model: String(settings.model ?? "gpt-image-1"),
      apiKey,
    }),
  };
};

/**
 * Compose the trusted course-builder guidance for THIS tenant: the platform
 * site prompt (definer-read, so a background job sees it without platform
 * context) layered with the company owner's own master prompt (tenant-scoped,
 * visible under the open transaction). Pure layering lives in prompt-composer.
 */
const composeGuidanceFor = async (ctx: AiContext): Promise<string> => {
  const siteResult = await ctx.tx.execute<{
    settings: Record<string, unknown> | null;
  }>(sql`SELECT settings FROM app_get_course_builder_config()`);
  const siteSettings = siteResult.rows[0]?.settings ?? null;
  const sitePrompt =
    siteSettings && typeof siteSettings.sitePrompt === "string"
      ? siteSettings.sitePrompt
      : null;

  const companyRow = await ctx.tx.query.companySettings.findFirst();

  return composeCourseGuidance({
    sitePrompt,
    companyPrompt: companyRow?.masterPrompt ?? null,
  });
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
  label: string,
  // Some ops (generateCourse) are too long to retry within the 300s route cap;
  // pass 1 to make a single attempt instead of the default retry-once.
  maxAttempts = 2
): Promise<{ data: T; usage: typeof ZERO_USAGE }> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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

/**
 * Translate ONE lesson's content into a target language (multi-language
 * courses, PR-B). Uses the TEXT provider. The source carries the
 * primary-language strings; the validator pins the model's output to the same
 * question/option counts so the caller can map translations back onto base ids
 * by index. Validated + metered like every other text op; the per-lesson
 * translate runner persists the result into the translation tables.
 */
export const translateLesson = async (
  ctx: AiContext,
  args: {
    targetLanguageLabel: string;
    source: TranslationSource;
  }
): Promise<LessonTranslationResult> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveProvider(ctx);

  const payload = JSON.stringify({
    title: args.source.title,
    teachingText: args.source.teachingText,
    questions: args.source.questions,
  });

  const { data, usage } = await validated(
    buildLessonTranslationSchema(args.source),
    () =>
      adapter.generateJson({
        prompt: buildTranslatePrompt({
          targetLanguageLabel: args.targetLanguageLabel,
          payload,
        }),
      }),
    AI_TIMEOUTS.translateLesson,
    "translateLesson"
  );

  await recordUsage(
    ctx,
    "translateLesson",
    providerName,
    usage,
    alertThresholdUsd
  );

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

/**
 * Full-course generation (AI Course Builder). Uses the TEXT provider to emit
 * the rich courseDraftSchema (modules → units → lessons + teachingText +
 * per-lesson image asset prompts + questions). The owner's brief idea is
 * sandwiched as DATA; the composed site+company guidance is trusted
 * instruction. The draft lands in the review queue — never auto-published
 * (D6) — and image assets are generated SEQUENTIALLY afterward (PR21).
 */
export const generateCourse = async (
  ctx: AiContext,
  args: { brief: CourseBrief; userBrief: string }
): Promise<CourseDraft> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveProvider(ctx);

  const guidance = await composeGuidanceFor(ctx);

  const { data, usage } = await validated(
    courseDraftSchema,
    () =>
      adapter.generateJson({
        prompt: buildCoursePrompt({
          guidance,
          brief: args.brief,
          userBrief: args.userBrief,
        }),
      }),
    AI_TIMEOUTS.generateCourse,
    "generateCourse",
    // Single attempt: a full-course retry would exceed the 300s route cap.
    1
  );

  await recordUsage(ctx, "generateCourse", providerName, usage, alertThresholdUsd);

  return data;
};

/**
 * Generate ONE image (AI Course Builder). The caller (PR21 pipeline) invokes
 * this strictly one asset at a time and persists the bytes to Blob behind the
 * authed media proxy. Style-primed per kind (icon / illustration / realistic).
 * Metered against the image provider's own row.
 */
export const generateImage = async (
  ctx: AiContext,
  args: { prompt: string; kind: "illustration" | "realistic" | "icon"; size?: number }
): Promise<ImageResult> => {
  const { adapter, providerName, alertThresholdUsd } =
    await resolveImageProvider(ctx);

  const result = await withTimeout(
    adapter.generateImage({
      prompt: buildImagePrompt(args.prompt, args.kind),
      size: args.size,
    }),
    AI_TIMEOUTS.generateImage,
    "generateImage"
  );

  await recordUsage(ctx, "generateImage", providerName, result.usage, alertThresholdUsd);

  return result;
};

type ResolvedTtsProvider = {
  adapter: TtsProviderAdapter;
  providerName: string;
  alertThresholdUsd: number | null;
};

/** Resolve a TTS provider via the active OpenClaw connection (generate_tts_audio). */
const resolveTtsProvider = async (ctx: AiContext): Promise<ResolvedTtsProvider> => {
  const result = await ctx.tx.execute<{
    provider: string | null;
    encrypted_key: string | null;
    settings: Record<string, unknown> | null;
    alert_threshold_usd: string | null;
  }>(sql`SELECT * FROM app_get_active_provider()`);
  const row = result.rows[0];

  if (row?.provider !== "openclaw") {
    throw new AppActionError(
      "conflict",
      "Voiceover needs OpenClaw as the active provider (its generate_tts_audio tool)."
    );
  }

  const settings = row.settings ?? {};
  let apiKey = "";
  if (row.encrypted_key) {
    try {
      apiKey = decryptSecret(row.encrypted_key);
    } catch {
      throw new AppActionError(
        "conflict",
        "The stored OpenClaw key could not be decrypted. Re-save it in platform settings."
      );
    }
  }

  return {
    providerName: "openclaw-tts",
    alertThresholdUsd: row.alert_threshold_usd ? Number(row.alert_threshold_usd) : null,
    adapter: new McpTtsAdapter({
      endpoint: String(settings.endpoint ?? ""),
      apiKey,
      toolName: "generate_tts_audio",
      voice: settings.ttsVoice ? String(settings.ttsVoice) : undefined,
      timeoutSeconds: 270,
    }),
  };
};

/**
 * Generate ONE lesson voiceover (AI Course Builder). Called by the asset
 * pipeline for AUDIO assets; bytes are persisted to Blob like images.
 */
export const generateSpeech = async (
  ctx: AiContext,
  args: { text: string; voice?: string }
): Promise<ImageResult> => {
  const { adapter, providerName, alertThresholdUsd } = await resolveTtsProvider(ctx);

  const result = await withTimeout(
    adapter.generateSpeech({ text: args.text, voice: args.voice }),
    AI_TIMEOUTS.generateSpeech,
    "generateSpeech"
  );

  await recordUsage(ctx, "generateSpeech", providerName, result.usage, alertThresholdUsd);

  return result;
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

/** Rough token estimate (~4 chars/token) for metering when the provider
 * returns no usage counts (e.g. the OpenClaw MCP bridge). */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

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
  let reteachPrompt = "";

  try {
    reteachPrompt = buildReteachPrompt({ question: args.question });
    const source = await adapter.streamText({
      prompt: reteachPrompt,
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

  // Meter now, while the caller's transaction is open (finding #5). Input
  // tokens are measured from the actual prompt; output is a cap estimate
  // since the reply streams to the client after this transaction closes.
  await recordUsage(
    ctx,
    "reteach",
    providerName,
    {
      inputTokens: estimateTokens(reteachPrompt),
      outputTokens: RETEACH_MAX_TOKENS,
      costUsd: 0,
    },
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
