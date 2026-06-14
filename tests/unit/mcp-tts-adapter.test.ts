import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TTS_INSTRUCTIONS,
  McpTtsAdapter,
} from "@/features/ai/adapters/mcp-tts";

/**
 * OpenClaw MCP TTS adapter — the "enforce premium, no robotic fallback" fix.
 * Verifies the voice-quality directive (`instructions`) + `model` + `voice`
 * ride along on every call, and that nothing is sent when unconfigured (so a
 * bridge that rejects unknown args isn't handed one). fetch is mocked.
 */

const ENDPOINT = "http://bridge.example:3489/mcp";

const makeAdapter = (
  over: Partial<ConstructorParameters<typeof McpTtsAdapter>[0]> = {}
) => new McpTtsAdapter({ endpoint: ENDPOINT, apiKey: "tok", ...over });

const audioReply = (data: string, mimeType = "audio/mpeg") => ({
  jsonrpc: "2.0",
  id: 1,
  result: { content: [{ type: "audio", data, mimeType }] },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const lastBodyArgs = (fetchMock: ReturnType<typeof vi.spyOn>) => {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string).params.arguments as Record<string, unknown>;
};

afterEach(() => vi.restoreAllMocks());

describe("McpTtsAdapter — premium-voice directive", () => {
  it("sends instructions + model + voice when configured, and returns the audio", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(audioReply("QUJD")));

    const result = await makeAdapter({
      voice: "nova",
      model: "tts-premium",
      instructions: DEFAULT_TTS_INSTRUCTIONS,
    }).generateSpeech({ text: "Walk the machine before the blade spins." });

    expect(result.b64).toBe("QUJD");
    expect(result.contentType).toBe("audio/mpeg");

    const args = lastBodyArgs(fetchMock);
    expect(args.text).toBe("Walk the machine before the blade spins.");
    expect(args.voice).toBe("nova");
    expect(args.model).toBe("tts-premium");
    expect(args.instructions).toBe(DEFAULT_TTS_INSTRUCTIONS);
    expect(String(args.instructions)).toMatch(/never fall back to a robotic/i);
  });

  it("omits instructions/model when not configured (no unknown args forced)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(audioReply("QUJD")));

    await makeAdapter().generateSpeech({ text: "hello" });

    const args = lastBodyArgs(fetchMock);
    expect(args.instructions).toBeUndefined();
    expect(args.model).toBeUndefined();
    expect(args.text).toBe("hello");
  });

  it("the default directive forbids the machine fallback and prefers no audio", () => {
    expect(DEFAULT_TTS_INSTRUCTIONS).toMatch(/premium/i);
    expect(DEFAULT_TTS_INSTRUCTIONS).toMatch(/no audio|produce no audio/i);
    expect(DEFAULT_TTS_INSTRUCTIONS).toMatch(/machine|robotic|synthesized/i);
  });
});
