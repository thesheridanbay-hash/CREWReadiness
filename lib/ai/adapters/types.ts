import type { ImageResult, Usage } from "../types";

export type GenerateJsonArgs = {
  prompt: string;
  /** Optional image input (photo→training pipeline). */
  imageUrl?: string;
  maxOutputTokens?: number;
};

export type GenerateJsonResult = {
  /** Parsed JSON — schema validation happens in the gateway, not here. */
  content: unknown;
  usage: Usage;
};

export type StreamTextArgs = {
  prompt: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export interface ProviderAdapter {
  readonly name: string;
  generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult>;
  /** Token stream; usage for streams is estimated by the gateway. */
  streamText(args: StreamTextArgs): Promise<AsyncIterable<string>>;
  transcribe(audioUrl: string): Promise<{ text: string; usage: Usage }>;
}

export type GenerateImageArgs = {
  prompt: string;
  /** Square size in px (provider clamps to supported sizes). */
  size?: number;
};

/**
 * Image generation is a SEPARATE provider from text (the brief's image model;
 * the OpenClaw text bridge can't do images). Adapters return bytes (b64) or a
 * URL; the caller persists to Blob.
 */
export interface ImageProviderAdapter {
  readonly name: string;
  generateImage(args: GenerateImageArgs): Promise<ImageResult>;
}
