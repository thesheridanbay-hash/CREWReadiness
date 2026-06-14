import { sql } from "drizzle-orm";

import { AppActionError } from "@/shared/errors";

import { DirectAdapter } from "./adapters/direct";
import { OpenAiImageAdapter } from "./adapters/image";
import { McpAdapter } from "./adapters/mcp";
import { McpImageAdapter } from "./adapters/mcp-image";
import { DEFAULT_TTS_INSTRUCTIONS, McpTtsAdapter } from "./adapters/mcp-tts";
import type {
  ImageProviderAdapter,
  ProviderAdapter,
  TtsProviderAdapter,
} from "./adapters/types";
import { decryptSecret } from "./crypto";
import type { AiContext } from "./types";

export type ResolvedProvider = {
  adapter: ProviderAdapter;
  providerName: string;
  alertThresholdUsd: number | null;
};

export const resolveProvider = async (ctx: AiContext): Promise<ResolvedProvider> => {
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
        // Bridge work budget. The gateway's per-op withTimeout is the real
        // bound; this just stops the bridge self-aborting a long call. Default
        // must clear the longest op (generateCourse, ~270s) — 120 silently
        // strangled full-course generation (it fits small calls but not a
        // ~2-min course build).
        timeoutSeconds:
          typeof settings.timeoutSeconds === "number"
            ? settings.timeoutSeconds
            : 290,
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

export type ResolvedImageProvider = {
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

export const resolveImageProvider = async (
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

export type ResolvedTtsProvider = {
  adapter: TtsProviderAdapter;
  providerName: string;
  alertThresholdUsd: number | null;
};

/** Resolve a TTS provider via the active OpenClaw connection (generate_tts_audio). */
export const resolveTtsProvider = async (ctx: AiContext): Promise<ResolvedTtsProvider> => {
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

  // Voice-quality directive (premium voice, no robotic/system fallback). Sent
  // on every voiceover call — new and regenerated. Override the wording with a
  // `ttsInstructions` string in provider settings, or set it to `false` to
  // disable (e.g. if the bridge rejects an unknown `instructions` arg).
  const ttsInstructions =
    settings.ttsInstructions === false
      ? undefined
      : typeof settings.ttsInstructions === "string" &&
          settings.ttsInstructions.trim()
        ? String(settings.ttsInstructions)
        : DEFAULT_TTS_INSTRUCTIONS;

  return {
    providerName: "openclaw-tts",
    alertThresholdUsd: row.alert_threshold_usd ? Number(row.alert_threshold_usd) : null,
    adapter: new McpTtsAdapter({
      endpoint: String(settings.endpoint ?? ""),
      apiKey,
      toolName: "generate_tts_audio",
      voice: settings.ttsVoice ? String(settings.ttsVoice) : undefined,
      // Premium model id, if the platform owner has pinned one in settings.
      model: settings.ttsModel ? String(settings.ttsModel) : undefined,
      instructions: ttsInstructions,
      timeoutSeconds: 270,
    }),
  };
};
