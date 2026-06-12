import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_AUTH_POLICY,
  evaluateLock,
  ipRateLimited,
  registerFailure,
  sessionExpiry,
  shouldRefreshSession,
} from "@/lib/auth/employee-policy";
import { PIN_PATTERN, hashPin, verifyPin } from "@/lib/auth/pin";

describe("PIN hashing (T2/D4)", () => {
  it("hashes and verifies a PIN", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("4821", hash)).toBe(true);
    expect(await verifyPin("4822", hash)).toBe(false);
  });

  it("uses a unique salt per hash", async () => {
    const [a, b] = await Promise.all([hashPin("4821"), hashPin("4821")]);
    expect(a).not.toBe(b);
    expect(await verifyPin("4821", a)).toBe(true);
    expect(await verifyPin("4821", b)).toBe(true);
  });

  it("rejects malformed stored hashes safely", async () => {
    expect(await verifyPin("4821", "garbage")).toBe(false);
    expect(await verifyPin("4821", "")).toBe(false);
  });

  it("PIN pattern allows 4-6 digits only", () => {
    expect(PIN_PATTERN.test("1234")).toBe(true);
    expect(PIN_PATTERN.test("123456")).toBe(true);
    expect(PIN_PATTERN.test("123")).toBe(false);
    expect(PIN_PATTERN.test("1234567")).toBe(false);
    expect(PIN_PATTERN.test("12a4")).toBe(false);
  });
});

describe("lockout policy (T2/D4, F6)", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("locks after MAX_FAILED_ATTEMPTS consecutive failures", () => {
    let state: { failedAttempts: number; lockedUntil: Date | null } = {
      failedAttempts: 0,
      lockedUntil: null,
    };

    for (let i = 1; i < EMPLOYEE_AUTH_POLICY.MAX_FAILED_ATTEMPTS; i++) {
      state = registerFailure(state.failedAttempts, now);
      expect(state.lockedUntil).toBeNull();
    }

    state = registerFailure(state.failedAttempts, now);
    expect(state.failedAttempts).toBe(EMPLOYEE_AUTH_POLICY.MAX_FAILED_ATTEMPTS);
    expect(state.lockedUntil).toEqual(
      new Date(now.getTime() + EMPLOYEE_AUTH_POLICY.LOCKOUT_MINUTES * 60_000)
    );
  });

  it("evaluateLock respects an active lock and expiry", () => {
    const until = new Date(now.getTime() + 60_000);
    expect(evaluateLock(until, now)).toEqual({ locked: true, until });
    expect(evaluateLock(until, new Date(until.getTime() + 1))).toEqual({
      locked: false,
    });
    expect(evaluateLock(null, now)).toEqual({ locked: false });
  });

  it("per-IP budget trips at the configured ceiling", () => {
    expect(ipRateLimited(EMPLOYEE_AUTH_POLICY.IP_MAX_ATTEMPTS - 1)).toBe(false);
    expect(ipRateLimited(EMPLOYEE_AUTH_POLICY.IP_MAX_ATTEMPTS)).toBe(true);
  });

  it("sessions slide: short idle expiry, refresh only after the threshold", () => {
    const expiry = sessionExpiry(now);
    expect(expiry).toEqual(
      new Date(
        now.getTime() + EMPLOYEE_AUTH_POLICY.SESSION_IDLE_MINUTES * 60_000
      )
    );

    const justSeen = new Date(now.getTime() - 60_000);
    const staleSeen = new Date(
      now.getTime() -
        (EMPLOYEE_AUTH_POLICY.SESSION_REFRESH_AFTER_MINUTES + 1) * 60_000
    );
    expect(shouldRefreshSession(justSeen, now)).toBe(false);
    expect(shouldRefreshSession(staleSeen, now)).toBe(true);
  });
});
