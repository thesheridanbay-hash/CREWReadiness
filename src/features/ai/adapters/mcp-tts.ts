import { randomUUID } from "node:crypto";

import { ZERO_USAGE, type ImageResult } from "../types";
import type { GenerateSpeechArgs, TtsProviderAdapter } from "./types";

/**
 * OpenClaw MCP text-to-speech adapter. The bridge's `generate_tts_audio` tool
 * returns an MCP audio content part — { type:"audio", data:<base64>,
 * mimeType:"audio/mpeg" }. Mirrors McpImageAdapter (same transport, unique
 * session per call to avoid the shared-session "Command failed" contention).
 */

type McpTtsConfig = {
  endpoint: string;
  apiKey: string;
  toolName?: string;
  voice?: string;
  model?: string;
  timeoutSeconds?: number;
};

type JsonRpcAudioResponse = {
  result?: {
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class McpTtsAdapter implements TtsProviderAdapter {
  readonly name = "openclaw-tts";

  private readonly config: McpTtsConfig;
  private rpcId = 0;

  constructor(config: McpTtsConfig) {
    this.config = config;
  }

  async generateSpeech(args: GenerateSpeechArgs): Promise<ImageResult> {
    if (!this.config.endpoint || !this.config.apiKey) {
      throw new Error("OpenClaw MCP endpoint or key is not configured.");
    }

    const toolArgs: Record<string, unknown> = {
      text: args.text,
      sessionId: `crew-tts-${randomUUID()}`,
    };
    const voice = args.voice ?? this.config.voice;
    if (voice) toolArgs.voice = voice;
    if (this.config.model) toolArgs.model = this.config.model;
    if (this.config.timeoutSeconds) toolArgs.timeoutSeconds = this.config.timeoutSeconds;

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.rpcId,
        method: "tools/call",
        params: { name: this.config.toolName ?? "generate_tts_audio", arguments: toolArgs },
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP generate_tts_audio failed: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    let payload: JsonRpcAudioResponse;
    if (contentType.includes("text/event-stream")) {
      const frames = bodyText
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((d) => d && d !== "[DONE]");
      const last = frames[frames.length - 1];
      if (!last) throw new Error("MCP generate_tts_audio: empty SSE response.");
      payload = JSON.parse(last) as JsonRpcAudioResponse;
    } else {
      payload = JSON.parse(bodyText) as JsonRpcAudioResponse;
    }

    if (payload.error) {
      throw new Error(`OpenClaw TTS error: ${payload.error.message}`);
    }
    if (payload.result?.isError) {
      const detail = (payload.result.content ?? []).map((c) => c.text).join(" ");
      throw new Error(`OpenClaw TTS tool error: ${detail.slice(0, 200)}`);
    }

    const audioPart = (payload.result?.content ?? []).find(
      (part) => part.type === "audio" && typeof part.data === "string" && part.data.length > 0
    );

    if (!audioPart?.data) {
      throw new Error("OpenClaw generate_tts_audio returned no audio data.");
    }

    return {
      b64: audioPart.data,
      contentType: audioPart.mimeType ?? "audio/mpeg",
      usage: { ...ZERO_USAGE, inputTokens: estimateTokens(args.text) },
    };
  }
}
