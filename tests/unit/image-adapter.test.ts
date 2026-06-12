import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiImageAdapter } from "@/lib/ai/adapters/image";

/**
 * OpenAI-compatible image adapter — request shape + response parsing, fetch
 * mocked. The pipeline persists the returned bytes to Blob, so we assert b64
 * comes back and that misconfig / provider errors throw rather than silently
 * yielding nothing.
 */

const makeAdapter = (over: Partial<ConstructorParameters<typeof OpenAiImageAdapter>[0]> = {}) =>
  new OpenAiImageAdapter({
    baseUrl: "https://images.example/v1",
    model: "gpt-image-1",
    apiKey: "tok",
    ...over,
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAiImageAdapter", () => {
  it("POSTs to {baseUrl}/images/generations with Bearer auth and b64 format", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: "QUJD" }] }));

    const result = await makeAdapter().generateImage({ prompt: "a mascot", size: 512 });

    expect(result.b64).toBe("QUJD");
    expect(result.contentType).toBe("image/png");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://images.example/v1/images/generations");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("gpt-image-1");
    expect(body.prompt).toBe("a mascot");
    expect(body.size).toBe("512x512");
    expect(body.response_format).toBe("b64_json");
  });

  it("defaults to a 1024 square when no size is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: "x" }] }));
    await makeAdapter().generateImage({ prompt: "p" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.size).toBe("1024x1024");
  });

  it("accepts a URL-only response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: [{ url: "https://cdn/img.png" }] })
    );
    const result = await makeAdapter().generateImage({ prompt: "p" });
    expect(result.url).toBe("https://cdn/img.png");
  });

  it("throws when the endpoint or key is unconfigured", async () => {
    await expect(makeAdapter({ apiKey: "" }).generateImage({ prompt: "p" })).rejects.toThrow(
      /not configured/i
    );
    await expect(makeAdapter({ baseUrl: "" }).generateImage({ prompt: "p" })).rejects.toThrow(
      /not configured/i
    );
  });

  it("surfaces a non-200 as an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "bad" }, 429));
    await expect(makeAdapter().generateImage({ prompt: "p" })).rejects.toThrow(/HTTP 429/);
  });

  it("throws when the provider returns no image", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    await expect(makeAdapter().generateImage({ prompt: "p" })).rejects.toThrow(/no image/i);
  });
});
