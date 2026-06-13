/**
 * Employee sign-in hardening policy (T2 — D4, outside-voice F6/F7).
 * Pure functions — unit-tested without a database.
 */

/** Cookie name — lives here (edge-safe module) so middleware can import it. */
export const EMPLOYEE_SESSION_COOKIE = "employee_session";

export const EMPLOYEE_AUTH_POLICY = {
  /** Consecutive failures before the account locks. */
  MAX_FAILED_ATTEMPTS: 5,
  /** Account lock duration after hitting the failure cap. */
  LOCKOUT_MINUTES: 15,
  /** Sliding window for per-IP attempt counting. */
  IP_WINDOW_MINUTES: 15,
  /** Max sign-in attempts per IP inside the window. */
  IP_MAX_ATTEMPTS: 20,
  /** Idle expiry for employee sessions (short — shared crew phones, D4). */
  SESSION_IDLE_MINUTES: 30,
  /** Only refresh the session row when this much idle time has passed. */
  SESSION_REFRESH_AFTER_MINUTES: 5,
  /** Invite link validity. */
  INVITE_EXPIRY_HOURS: 72,
} as const;

export type LockState =
  | { locked: false }
  | { locked: true; until: Date };

/** Is the account currently locked? */
export const evaluateLock = (
  lockedUntil: Date | null,
  now: Date
): LockState => {
  if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
    return { locked: true, until: lockedUntil };
  }
  return { locked: false };
};

/** Next credential state after a failed attempt. */
export const registerFailure = (
  failedAttempts: number,
  now: Date
): { failedAttempts: number; lockedUntil: Date | null } => {
  const next = failedAttempts + 1;

  if (next >= EMPLOYEE_AUTH_POLICY.MAX_FAILED_ATTEMPTS) {
    return {
      failedAttempts: next,
      lockedUntil: new Date(
        now.getTime() + EMPLOYEE_AUTH_POLICY.LOCKOUT_MINUTES * 60_000
      ),
    };
  }

  return { failedAttempts: next, lockedUntil: null };
};

/** Whether a per-IP attempt count inside the window exceeds the budget. */
export const ipRateLimited = (attemptsInWindow: number): boolean =>
  attemptsInWindow >= EMPLOYEE_AUTH_POLICY.IP_MAX_ATTEMPTS;

/** Session expiry timestamp from now (sliding idle window). */
export const sessionExpiry = (now: Date): Date =>
  new Date(
    now.getTime() + EMPLOYEE_AUTH_POLICY.SESSION_IDLE_MINUTES * 60_000
  );

/** Should the session row's sliding expiry be refreshed on this read? */
export const shouldRefreshSession = (lastSeenAt: Date, now: Date): boolean =>
  now.getTime() - lastSeenAt.getTime() >
  EMPLOYEE_AUTH_POLICY.SESSION_REFRESH_AFTER_MINUTES * 60_000;
