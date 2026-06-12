import type { Usage } from "../types";

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
