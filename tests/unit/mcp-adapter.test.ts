import { afterEach, describe, expect, it, vi } from "vitest";

import { McpAdapter } from "@/features/ai/adapters/mcp";

/**
 * MCP adapter (OpenClaw bridge) — JSON-RPC framing + response parsing, with
 * fetch mocked. Verified against the live ai-hassan-openclaw-bridge shapes.
 */

const ENDPOINT = "http://bridge.example:3489/mcp";

const makeAdapter = (over: Partial<ConstructorParameters<typeof McpAdapter>[0]> = {}) =>
  new McpAdapter({
    endpoint: ENDPOINT,
    apiKey: "tok",
    toolName: "ask_ai_hassan",
    ...over,
  });

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const toolReply = (text: string) => ({
  jsonrpc: "2.0",
  id: 1,
  result: { content: [{ type: "text", text }] },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpAdapter request framing", () => {
  it("calls tools/call with the configured tool name + Bearer auth", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(toolReply("hi")));

    const adapter = makeAdapter({ model: "claude", thinking: "low" });
    const stream = await adapter.streamText({ prompt: "teach me" });
    let out = "";
    for await (const chunk of stream) out += chunk;

    expect(out).toBe("hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("ask_ai_hassan");
    expect(body.params.arguments.message).toBe("teach me");
    expect(body.params.arguments.model).toBe("claude");
    expect(body.params.arguments.thinking).toBe("low");
  });
});

describe("McpAdapter response parsing", () => {
  it("concatenates text parts from result.content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "AB" }, { type: "text", text: "CD" }] },
      })
    );
    const stream = await makeAdapter().streamText({ prompt: "x" });
    let out = "";
    for await (const chunk of stream) out += chunk;
    expect(out).toBe("ABCD");
  });

  it("parses a Streamable-HTTP SSE response (last data frame)", async () => {
    const sse =
      "event: message\n" +
      `data: ${JSON.stringify(toolReply("streamed"))}\n\n`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
    );
    const stream = await makeAdapter().streamText({ prompt: "x" });
    let out = "";
    for await (const chunk of stream) out += chunk;
    expect(out).toBe("streamed");
  });

  it("throws on a JSON-RPC error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } })
    );
    const stream = await makeAdapter().streamText({ prompt: "x" });
    await expect((async () => {
      for await (const _ of stream) void _;
    })()).rejects.toThrow(/boom/);
  });

  it("throws on a tool-level error (isError)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { isError: true, content: [{ type: "text", text: "rate limited" }] },
      })
    );
    const stream = await makeAdapter().streamText({ prompt: "x" });
    await expect((async () => {
      for await (const _ of stream) void _;
    })()).rejects.toThrow(/rate limited/);
  });

  it("throws on an empty reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { content: [] } })
    );
    const stream = await makeAdapter().streamText({ prompt: "x" });
    await expect((async () => {
      for await (const _ of stream) void _;
    })()).rejects.toThrow(/empty/i);
  });

  it("surfaces non-200 HTTP as an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 502 })
    );
    const stream = await makeAdapter().streamText({ prompt: "x" });
    await expect((async () => {
      for await (const _ of stream) void _;
    })()).rejects.toThrow(/HTTP 502/);
  });
});

describe("McpAdapter generateJson", () => {
  it("parses a raw JSON reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(toolReply('{"title":"Mowing","lessons":[]}'))
    );
    const { content } = await makeAdapter().generateJson({ prompt: "make a lesson" });
    expect(content).toEqual({ title: "Mowing", lessons: [] });
  });

  it("strips ```json fences before parsing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(toolReply('```json\n{"ok":true}\n```'))
    );
    const { content } = await makeAdapter().generateJson({ prompt: "x" });
    expect(content).toEqual({ ok: true });
  });

  it("notes an image reference in the prompt (bridge is text-only)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(toolReply("{}")));
    await makeAdapter().generateJson({ prompt: "assess", imageUrl: "https://x/y.jpg" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.params.arguments.message).toContain("https://x/y.jpg");
  });
});

describe("McpAdapter transcribe", () => {
  it("is unsupported and throws", async () => {
    await expect(makeAdapter().transcribe()).rejects.toThrow(
      /does not support audio/i
    );
  });
});
