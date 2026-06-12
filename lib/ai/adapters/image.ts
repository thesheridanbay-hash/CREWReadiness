import { ZERO_USAGE, type ImageResult } from "../types";
import type { GenerateImageArgs, ImageProviderAdapter } from "./types";

/**
 * OpenAI-compatible image generation (POST {baseUrl}/images/generations).
 * Works with OpenAI Images and any compatible endpoint (e.g. a Gemini "Nano
 * Banana" proxy that speaks the same shape). Returns base64 bytes so the
 * caller can persist to Blob behind the authed media proxy — generated
 * lesson/icon art is tenant content, never a hotlinked external URL.
 *
 * Image generation is deliberately a separate provider from the text model
 * (different model + key); the text OpenClaw bridge has no image capability.
 */
export class OpenAiImageAdapter implements ImageProviderAdapter {
  readonly name = "openai-image";

  private readonly config: { baseUrl: string; model: string; apiKey: string };

  constructor(config: { baseUrl: string; model: string; apiKey: string }) {
    this.config = config;
  }

  async generateImage(args: GenerateImageArgs): Promise<ImageResult> {
    if (!this.config.apiKey || !this.config.baseUrl) {
      throw new Error("Image provider endpoint or key is not configured.");
    }

    const size = args.size ?? 1024;
    const response = await fetch(`${this.config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt: args.prompt,
        n: 1,
        size: `${size}x${size}`,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Image generation failed: HTTP ${response.status} ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const first = body.data?.[0];
    if (!first || (!first.b64_json && !first.url)) {
      throw new Error("Image provider returned no image.");
    }

    return {
      b64: first.b64_json,
      url: first.url,
      contentType: "image/png",
      usage: {
        ...ZERO_USAGE,
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
    };
  }
}
