import type {
  GenerateJsonArgs,
  GenerateJsonResult,
  ProviderAdapter,
  StreamTextArgs,
} from "./types";
import { DirectAdapter } from "./direct";

/**
 * OpenClaw adapter (T4 — D5): the current "mule" — the user's OpenClaw
 * instance exposed via its public MCP endpoint on a fixed IP, which fronts
 * an OpenAI-compatible completions surface.
 *
 * Implementation note: the endpoint speaks the OpenAI-compatible protocol,
 * so this wraps DirectAdapter with OpenClaw's endpoint + auth. If the
 * endpoint contract diverges during P3 wiring, this class is the seam to
 * absorb it — app code only ever sees the gateway.
 *
 * Config (provider_settings.settings): { "endpoint": "http://<fixed-ip>/v1",
 * "model": "..." }; key in encrypted_key.
 */
export class OpenClawAdapter implements ProviderAdapter {
  readonly name = "openclaw";

  private readonly inner: DirectAdapter;

  constructor(config: { endpoint: string; model: string; apiKey: string }) {
    this.inner = new DirectAdapter({
      baseUrl: config.endpoint,
      model: config.model,
      apiKey: config.apiKey,
    });
  }

  generateJson(args: GenerateJsonArgs): Promise<GenerateJsonResult> {
    return this.inner.generateJson(args);
  }

  streamText(args: StreamTextArgs): Promise<AsyncIterable<string>> {
    return this.inner.streamText(args);
  }

  transcribe(audioUrl: string) {
    return this.inner.transcribe(audioUrl);
  }
}
