import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Employee PIN hashing (T2 — D4). scrypt with a per-credential salt; format
 * "salt:hash" (hex). PINs are 4-6 digits — low entropy by design (shared crew
 * phones, gloves, sunlight) — so the REAL protection is the lockout +
 * rate-limit policy (employee-policy.ts), not hash hardness. scrypt's cost
 * still makes offline cracking of a leaked hash expensive.
 */

const KEY_LENGTH = 64;

const scryptAsync = (pin: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });

export const PIN_PATTERN = /^\d{4,6}$/;

export const hashPin = async (pin: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(pin, salt);
  return `${salt}:${derived.toString("hex")}`;
};

export const verifyPin = async (
  pin: string,
  stored: string
): Promise<boolean> => {
  const [salt, expectedHex] = stored.split(":");

  if (!salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scryptAsync(pin, salt);

  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
};
