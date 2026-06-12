import { ZERO_USAGE, type Usage } from "../types";
import type {
  GenerateJsonArgs,
  GenerateJsonResult,
  ProviderAdapter,
  StreamTextArgs,
} from "./types";

/**
 * Direct API adapter (T4 — D5): talks to any OpenAI-compatible
 * chat-completions endpoint (OpenAI, OpenRouter, and compatible gateways for
 * Claude/Gemini). Configured per provider_settings; key decryption happens
 * upstream in the gateway.
 *
 * Cost: token counts come from the response; USD pricing is model-dependent
 * and tracked as 0 until the pricing table lands with the P4 usage surface
 * (metering still records tokens per company).
 */

type DirectConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number };

/**
 * Review finding #10 (SSRF): media URLs come from our own rows, but until
 * T11's authed proxy mints them they must still never point the server at
 * internal endpoints. HTTPS only + hostname suffix allowlist
 * (MEDIA_ALLOWED_HOSTS, comma-separated; default: Vercel Blob).
 */
const assertAllowedMediaUrl = (rawUrl: string): void => {
  const allowed = (
    process.env.MEDIA_ALLOWED_HOSTS ?? "blob.vercel-storage.com"
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("transcribe: media URL is not a valid absolute URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const permitted =
    parsed.protocol === "https:" &&
    allowed.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );

  if (!permitted) {
    throw new Error(
      `transcribe: media host "${hostname}" is not on the allowlist`
    );
  }
};

const toUsage = (usage: ChatUsage | undefined): Usage => ({
  inputTokens: usage?.prompt_tokens ?? 0,
  outputTokens: usage?.completion_tokens ?? 0,
  costUsd: 0,
});

export class DirectAdapter implements ProviderAdapter {
  readonly name = "direct";

  constructor(private readonly config: DirectConfig) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult> {
    const content: unknown[] = [{ type: "text", text: args.prompt }];

    if (args.imageUrl) {
      content.push({ type: "image_url", image_url: { url: args.imageUrl } });
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
        max_tokens: args.maxOutputTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `direct adapter: ${response.status} ${await response.text()}`
      );
    }

    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: ChatUsage;
    };

    const raw = body.choices[0]?.message?.content ?? "";

    return { content: JSON.parse(raw), usage: toUsage(body.usage) };
  }

  async streamText(args: StreamTextArgs): Promise<AsyncIterable<string>> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      signal: args.signal,
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "user", content: args.prompt }],
        stream: true,
        max_tokens: args.maxOutputTokens ?? 512,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `direct adapter (stream): ${response.status} ${await response.text()}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Review finding #8: cap the partial-line buffer so a pathological
    // stream (one endless unterminated line) can't grow memory unbounded.
    const MAX_BUFFER = 1_048_576;

    async function* iterate(): AsyncIterable<string> {
      let buffer = "";

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          if (buffer.length > MAX_BUFFER) {
            throw new Error("direct adapter (stream): SSE buffer cap exceeded");
          }
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) yield token;
            } catch {
              // Ignore malformed keep-alive lines.
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    return iterate();
  }

  async transcribe(audioUrl: string): Promise<{ text: string; usage: Usage }> {
    assertAllowedMediaUrl(audioUrl);

    const audio = await fetch(audioUrl);

    if (!audio.ok) {
      throw new Error(`direct adapter: could not fetch audio (${audio.status})`);
    }

    const form = new FormData();
    form.append("file", await audio.blob(), "audio.m4a");
    form.append("model", "whisper-1");

    const response = await fetch(`${this.config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(
        `direct adapter (transcribe): ${response.status} ${await response.text()}`
      );
    }

    const body = (await response.json()) as { text: string };

    return { text: body.text, usage: ZERO_USAGE };
  }
}
