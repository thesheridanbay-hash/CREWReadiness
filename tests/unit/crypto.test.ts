import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, isProviderKeyConfigError } from "@/features/ai/crypto";

/** Provider-key encryption (D5). */

describe("provider key encryption", () => {
  const prev = process.env.PROVIDER_KEY_SECRET;

  beforeEach(() => {
    process.env.PROVIDER_KEY_SECRET = "test-secret-at-least-sixteen-chars-long";
  });
  afterEach(() => {
    process.env.PROVIDER_KEY_SECRET = prev;
  });

  it("round-trips a secret", () => {
    const plain = "sk-super-secret-provider-key-123";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toContain(plain);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random salt + iv)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("fails authentication on tampering", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(":");
    const tamperedData = Buffer.from("evil").toString("base64");
    const tampered = [parts[0], parts[1], parts[2], parts[3], tamperedData].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("refuses to encrypt without PROVIDER_KEY_SECRET", () => {
    delete process.env.PROVIDER_KEY_SECRET;
    try {
      encryptSecret("secret");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isProviderKeyConfigError(error)).toBe(true);
    }
  });
});
