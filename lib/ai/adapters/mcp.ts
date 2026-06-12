import type { Usage } from "../types";
import type {
  GenerateJsonArgs,
  GenerateJsonResult,
  ProviderAdapter,
  StreamTextArgs,
} from "./types";

/**
 * MCP adapter (OpenClaw bridge). The "openclaw" provider is a Model Context
 * Protocol server (Streamable HTTP, JSON-RPC 2.0), NOT an OpenAI-compatible
 * API. Discovery against the live bridge (ai-hassan-openclaw-bridge,
 * protocol 2025-06-18) showed:
 *   - stateless (no Mcp-Session-Id), responds application/json
 *   - one generation tool `ask_ai_hassan` { message, model?, thinking?,
 *     timeoutSeconds? } → result.content[] of { type:"text", text }
 *
 * Every gateway call maps to a single `tools/call` of that tool. There is no
 * token streaming, so streamText yields the full reply once — the reteach
 * path still runs it through the answer-leak guard, so the safety property
 * holds. The tool name + model + thinking are configurable so the adapter
 * adapts if the bridge changes.
 *
 * Usage: the bridge returns no token counts, so usage is estimated from text
 * length (~4 chars/token) purely for per-company metering.
 */

type McpConfig = {
  endpoint: string;
  apiKey: string;
  toolName: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export class McpAdapter implements ProviderAdapter {
  readonly name = "openclaw";

  private readonly config: McpConfig;
  private rpcId = 0;

  constructor(config: McpConfig) {
    this.config = config;
  }

  /** Low-level JSON-RPC call over the MCP Streamable HTTP transport. */
  private async rpc(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<JsonRpcResponse> {
    if (!this.config.endpoint || !this.config.apiKey) {
      throw new Error("OpenClaw MCP endpoint or key is not configured.");
    }

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
        method,
        params,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`MCP ${method} failed: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    // Streamable HTTP may answer with an SSE stream; take the last data frame.
    if (contentType.includes("text/event-stream")) {
      const frames = body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((d) => d && d !== "[DONE]");
      const last = frames[frames.length - 1];
      if (!last) throw new Error(`MCP ${method}: empty SSE response.`);
      return JSON.parse(last) as JsonRpcResponse;
    }

    return JSON.parse(body) as JsonRpcResponse;
  }

  /** Run the generation tool and return its concatenated text reply. */
  private async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    const args: Record<string, unknown> = { message: prompt };
    if (this.config.model) args.model = this.config.model;
    if (this.config.thinking) args.thinking = this.config.thinking;
    if (this.config.timeoutSeconds) args.timeoutSeconds = this.config.timeoutSeconds;

    const response = await this.rpc(
      "tools/call",
      { name: this.config.toolName, arguments: args },
      signal
    );

    if (response.error) {
      throw new Error(`OpenClaw error: ${response.error.message}`);
    }
    if (response.result?.isError) {
      const detail = response.result.content?.map((c) => c.text).join(" ") ?? "";
      throw new Error(`OpenClaw tool error: ${detail.slice(0, 200)}`);
    }

    const text = (response.result?.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("")
      .trim();

    if (!text) throw new Error("OpenClaw returned an empty reply.");
    return text;
  }

  private usageFor(prompt: string, reply: string): Usage {
    return {
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(reply),
      costUsd: 0, // bridge bills upstream; we meter calls/tokens, not $ here
    };
  }

  /** Strip ```json fences a model may wrap around structured output. */
  private static parseJson(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1] : text;
    return JSON.parse(candidate);
  }

  async generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult> {
    // The MCP bridge is text-only; image inputs aren't forwarded. Note the
    // image reference in the prompt so the assistant can account for it.
    const prompt = args.imageUrl
      ? `${args.prompt}\n\n[An image was provided at ${args.imageUrl} — describe/assess from context if you cannot fetch it.]`
      : args.prompt;

    const reply = await this.ask(prompt);
    return {
      content: McpAdapter.parseJson(reply),
      usage: this.usageFor(prompt, reply),
    };
  }

  async streamText(args: StreamTextArgs): Promise<AsyncIterable<string>> {
    // Lazy generator: the fetch runs on first iteration so the gateway's
    // connect-timeout (which wraps THIS call) resolves immediately and the
    // bridge's own latency budget governs the actual call.
    const ask = (prompt: string, signal?: AbortSignal) => this.ask(prompt, signal);
    const { prompt, signal } = args;

    async function* generate(): AsyncIterable<string> {
      const reply = await ask(prompt, signal);
      yield reply;
    }

    return generate();
  }

  async transcribe(): Promise<{ text: string; usage: Usage }> {
    // The OpenClaw bridge exposes only a text-generation tool; audio
    // transcription needs a transcription-capable provider (voice pipeline
    // dead-letters cleanly until one is configured).
    throw new Error("OpenClaw MCP bridge does not support audio transcription.");
  }
}
