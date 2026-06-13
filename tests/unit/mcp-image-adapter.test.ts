import { afterEach, describe, expect, it, vi } from "vitest";

import { McpImageAdapter } from "@/features/ai/adapters/mcp-image";

/**
 * OpenClaw MCP image adapter — request framing + extraction of the MCP image
 * content part, fetch mocked. Verified against the live bridge's generate_image
 * shape: result.content[] with { type:"image", data:<base64>, mimeType }.
 */

const ENDPOINT = "http://bridge.example:3489/mcp";

const makeAdapter = (over: Partial<ConstructorParameters<typeof McpImageAdapter>[0]> = {}) =>
  new McpImageAdapter({ endpoint: ENDPOINT, apiKey: "tok", ...over });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const imageReply = (data: string, mimeType = "image/png") => ({
  jsonrpc: "2.0",
  id: 1,
  result: { content: [{ type: "image", data, mimeType }, { type: "text", text: "{\"ok\":true}" }] },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpImageAdapter", () => {
  it("calls generate_image with the prompt + Bearer auth and returns the base64", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(imageReply("QUJD")));

    const result = await makeAdapter({ model: "flux", timeoutSeconds: 110 }).generateImage({
      prompt: "a mascot",
    });

    expect(result.b64).toBe("QUJD");
    expect(result.contentType).toBe("image/png");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("generate_image");
    expect(body.params.arguments.prompt).toBe("a mascot");
    expect(body.params.arguments.model).toBe("flux");
    expect(body.params.arguments.timeoutSeconds).toBe(110);
  });

  it("parses an SSE response and keeps the declared mimeType", async () => {
    const sse = `event: message\ndata: ${JSON.stringify(imageReply("Wlla", "image/jpeg"))}\n\n`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
    );
    const result = await makeAdapter().generateImage({ prompt: "x" });
    expect(result.b64).toBe("Wlla");
    expect(result.contentType).toBe("image/jpeg");
  });

  it("throws when the endpoint or key is unconfigured", async () => {
    await expect(makeAdapter({ apiKey: "" }).generateImage({ prompt: "p" })).rejects.toThrow(
      /not configured/i
    );
  });

  it("throws on a JSON-RPC error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } })
    );
    await expect(makeAdapter().generateImage({ prompt: "p" })).rejects.toThrow(/boom/);
  });

  it("throws on a tool-level error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { isError: true, content: [{ type: "text", text: "no model" }] },
      })
    );
    await expect(makeAdapter().generateImage({ prompt: "p" })).rejects.toThrow(/no model/);
  });

  it("throws when no image part is returned (text only)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "hi" }] } })
    );
    await expect(makeAdapter().generateImage({ prompt: "p" })).rejects.toThrow(/no image data/i);
  });

  it("surfaces non-200 HTTP as an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }));
    await expect(makeAdapter().generateImage({ prompt: "p" })).rejects.toThrow(/HTTP 502/);
  });
});
