import { ZERO_USAGE, type ImageResult } from "../types";
import type { GenerateImageArgs, ImageProviderAdapter } from "./types";

/**
 * OpenClaw MCP image adapter. The bridge's `generate_image` tool returns a
 * standard MCP image content part — { type:"image", data:<base64>,
 * mimeType:"image/png" } — verified live. This lets the course builder use the
 * SAME OpenClaw connection for images as for text, with no separate key.
 *
 * Latency note: generation is slow (~100s observed). The gateway wraps this in
 * its own timeout; the asset pipeline runs one image per Inngest step. On a
 * serverless host with a short function cap (e.g. Vercel free tier ~60s) a slow
 * image can exceed the per-invocation limit — an async bridge tool (kick + poll)
 * is the durable fix. `timeoutSeconds` is sent so the bridge doesn't give up
 * before the model finishes.
 */

type McpImageConfig = {
  endpoint: string;
  apiKey: string;
  toolName?: string;
  model?: string;
  timeoutSeconds?: number;
};

type JsonRpcImageResponse = {
  result?: {
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class McpImageAdapter implements ImageProviderAdapter {
  readonly name = "openclaw-image";

  private readonly config: McpImageConfig;
  private rpcId = 0;

  constructor(config: McpImageConfig) {
    this.config = config;
  }

  async generateImage(args: GenerateImageArgs): Promise<ImageResult> {
    if (!this.config.endpoint || !this.config.apiKey) {
      throw new Error("OpenClaw MCP endpoint or key is not configured.");
    }

    const toolArgs: Record<string, unknown> = { prompt: args.prompt };
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
        params: { name: this.config.toolName ?? "generate_image", arguments: toolArgs },
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP generate_image failed: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    // Streamable HTTP may answer with SSE; take the last data frame.
    let payload: JsonRpcImageResponse;
    if (contentType.includes("text/event-stream")) {
      const frames = bodyText
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((d) => d && d !== "[DONE]");
      const last = frames[frames.length - 1];
      if (!last) throw new Error("MCP generate_image: empty SSE response.");
      payload = JSON.parse(last) as JsonRpcImageResponse;
    } else {
      payload = JSON.parse(bodyText) as JsonRpcImageResponse;
    }

    if (payload.error) {
      throw new Error(`OpenClaw image error: ${payload.error.message}`);
    }
    if (payload.result?.isError) {
      const detail = (payload.result.content ?? []).map((c) => c.text).join(" ");
      throw new Error(`OpenClaw image tool error: ${detail.slice(0, 200)}`);
    }

    const imagePart = (payload.result?.content ?? []).find(
      (part) => part.type === "image" && typeof part.data === "string" && part.data.length > 0
    );

    if (!imagePart?.data) {
      throw new Error("OpenClaw generate_image returned no image data.");
    }

    return {
      b64: imagePart.data,
      contentType: imagePart.mimeType ?? "image/png",
      usage: { ...ZERO_USAGE, inputTokens: estimateTokens(args.prompt) },
    };
  }
}
