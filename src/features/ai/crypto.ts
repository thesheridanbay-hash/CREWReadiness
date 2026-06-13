import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Provider-key encryption at rest (D5). AES-256-GCM with a key derived from
 * PROVIDER_KEY_SECRET. The stored value is `v1:salt:iv:authTag:ciphertext`
 * (all base64). We never store provider API keys in plaintext, and the secret
 * lives only in the server environment — never in the database or the client.
 *
 * If PROVIDER_KEY_SECRET is absent we refuse to encrypt rather than silently
 * persisting a recoverable secret.
 */

const VERSION = "v1";

class ProviderKeyConfigError extends Error {}

const deriveKey = (salt: Buffer): Buffer => {
  const secret = process.env.PROVIDER_KEY_SECRET;
  if (!secret || secret.length < 16) {
    throw new ProviderKeyConfigError(
      "PROVIDER_KEY_SECRET (32+ random chars) must be set to store provider keys."
    );
  }
  return scryptSync(secret, salt, 32);
};

export const isProviderKeyConfigError = (error: unknown): boolean =>
  error instanceof ProviderKeyConfigError;

export const encryptSecret = (plaintext: string): string => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    salt.toString("base64"),
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

export const decryptSecret = (stored: string): string => {
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted provider key.");
  }
  const [, saltB64, ivB64, tagB64, dataB64] = parts;
  const key = deriveKey(Buffer.from(saltB64, "base64"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
};
