import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import db from "@/db/drizzle";
import {
  employeeCredentials,
  employeeInvites,
  employeeLoginAttempts,
  employeeSessions,
} from "@/db/schema";
import {
  EMPLOYEE_AUTH_POLICY,
  EMPLOYEE_SESSION_COOKIE,
  evaluateLock,
  ipRateLimited,
  registerFailure,
  sessionExpiry,
  shouldRefreshSession,
} from "./employee-policy";
import { hashPin, verifyPin } from "./pin";

/**
 * Employee credential flows (T2 — D4): invite link → set PIN → username+PIN
 * sign-in, hardened with per-account lockout + per-IP rate limiting, short
 * idle DB-backed sessions, manager PIN reset, and explicit user switch for
 * shared crew phones.
 *
 * These functions touch auth-infrastructure tables directly (not via
 * scoped()) — sign-in necessarily runs before tenant context exists. Every
 * query here is keyed by companyId/unguessable ids; keep it that way.
 */

const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type EmployeeSignInResult =
  | { ok: true; userId: string; companyId: string; displayName: string }
  | {
      ok: false;
      reason: "rate_limited" | "locked" | "invalid_credentials";
      lockedUntil?: Date;
    };

/** Record an IP attempt and report whether the IP is over budget. */
const checkAndRecordIp = async (ip: string): Promise<boolean> => {
  const windowStart = new Date(
    Date.now() - EMPLOYEE_AUTH_POLICY.IP_WINDOW_MINUTES * 60_000
  );

  // Opportunistic prune keeps the table small without a scheduled job.
  await db
    .delete(employeeLoginAttempts)
    .where(lt(employeeLoginAttempts.attemptedAt, windowStart));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employeeLoginAttempts)
    .where(
      and(
        eq(employeeLoginAttempts.ip, ip),
        gt(employeeLoginAttempts.attemptedAt, windowStart)
      )
    );

  await db.insert(employeeLoginAttempts).values({ ip });

  return ipRateLimited(count);
};

export const employeeSignIn = async (
  companyId: string,
  username: string,
  pin: string,
  ip: string
): Promise<EmployeeSignInResult> => {
  if (await checkAndRecordIp(ip)) {
    return { ok: false, reason: "rate_limited" };
  }

  const credential = await db.query.employeeCredentials.findFirst({
    where: and(
      eq(employeeCredentials.companyId, companyId),
      eq(employeeCredentials.username, username.toLowerCase().trim())
    ),
  });

  // Verify against a constant dummy hash when the user is unknown, so the
  // response time doesn't reveal whether a username exists.
  if (!credential) {
    await verifyPin(pin, "00000000000000000000000000000000:00");
    return { ok: false, reason: "invalid_credentials" };
  }

  const now = new Date();
  const lock = evaluateLock(credential.lockedUntil, now);

  if (lock.locked) {
    return { ok: false, reason: "locked", lockedUntil: lock.until };
  }

  const valid = await verifyPin(pin, credential.pinHash);

  if (!valid) {
    const next = registerFailure(credential.failedAttempts, now);
    await db
      .update(employeeCredentials)
      .set(next)
      .where(eq(employeeCredentials.id, credential.id));

    if (next.lockedUntil) {
      return { ok: false, reason: "locked", lockedUntil: next.lockedUntil };
    }
    return { ok: false, reason: "invalid_credentials" };
  }

  // Success: clear failure counters and open a session.
  await db
    .update(employeeCredentials)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(employeeCredentials.id, credential.id));

  const [session] = await db
    .insert(employeeSessions)
    .values({
      companyId: credential.companyId,
      userId: credential.userId,
      expiresAt: sessionExpiry(now),
    })
    .returning();

  const cookieStore = await cookies();
  cookieStore.set(EMPLOYEE_SESSION_COOKIE, session.id, {
    ...sessionCookieOptions,
    // Cookie outlives the idle window; the DB row is the source of truth.
    maxAge: 60 * 60 * 12,
  });

  return {
    ok: true,
    userId: credential.userId,
    companyId: credential.companyId,
    displayName: credential.displayName,
  };
};

export type EmployeeSessionInfo = {
  userId: string;
  companyId: string;
  displayName: string;
};

/** Resolve + slide the employee session from the request cookie. */
export const getEmployeeSession =
  async (): Promise<EmployeeSessionInfo | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get(EMPLOYEE_SESSION_COOKIE)?.value;

    if (!token) return null;

    const session = await db.query.employeeSessions.findFirst({
      where: eq(employeeSessions.id, token),
    });

    const now = new Date();

    if (!session || session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    if (shouldRefreshSession(session.lastSeenAt, now)) {
      await db
        .update(employeeSessions)
        .set({ lastSeenAt: now, expiresAt: sessionExpiry(now) })
        .where(eq(employeeSessions.id, session.id));
    }

    const credential = await db.query.employeeCredentials.findFirst({
      where: eq(employeeCredentials.userId, session.userId),
    });

    if (!credential) return null;

    return {
      userId: session.userId,
      companyId: session.companyId,
      displayName: credential.displayName,
    };
  };

/** Explicit user switch / sign out for shared crew phones (D4). */
export const employeeSignOut = async (): Promise<void> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(EMPLOYEE_SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(employeeSessions).where(eq(employeeSessions.id, token));
    cookieStore.delete(EMPLOYEE_SESSION_COOKIE);
  }
};

/** Owner/manager creates an invite carrying username + display name. */
export const createEmployeeInvite = async (
  companyId: string,
  username: string,
  displayName: string,
  createdBy: string
) => {
  const [invite] = await db
    .insert(employeeInvites)
    .values({
      companyId,
      username: username.toLowerCase().trim(),
      displayName,
      createdBy,
      expiresAt: new Date(
        Date.now() + EMPLOYEE_AUTH_POLICY.INVITE_EXPIRY_HOURS * 3_600_000
      ),
    })
    .returning();

  return invite;
};

export type AcceptInviteResult =
  | { ok: true; userId: string; companyId: string }
  | { ok: false; reason: "invalid_invite" | "username_taken" };

/** Employee opens the invite link and sets their PIN. */
export const acceptEmployeeInvite = async (
  inviteId: string,
  pin: string
): Promise<AcceptInviteResult> => {
  const invite = await db.query.employeeInvites.findFirst({
    where: eq(employeeInvites.id, inviteId),
  });

  const now = new Date();

  if (!invite || invite.usedAt || invite.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid_invite" };
  }

  const taken = await db.query.employeeCredentials.findFirst({
    where: and(
      eq(employeeCredentials.companyId, invite.companyId),
      eq(employeeCredentials.username, invite.username)
    ),
  });

  if (taken) return { ok: false, reason: "username_taken" };

  const userId = `emp_${randomUUID()}`;

  await db.insert(employeeCredentials).values({
    companyId: invite.companyId,
    userId,
    username: invite.username,
    displayName: invite.displayName,
    pinHash: await hashPin(pin),
    createdBy: invite.createdBy,
  });

  await db
    .update(employeeInvites)
    .set({ usedAt: now })
    .where(eq(employeeInvites.id, invite.id));

  return { ok: true, userId, companyId: invite.companyId };
};

/** Manager-initiated PIN reset (D4): sets a new PIN, clears lockout, revokes sessions. */
export const resetEmployeePin = async (
  companyId: string,
  targetUserId: string,
  newPin: string
): Promise<boolean> => {
  const credential = await db.query.employeeCredentials.findFirst({
    where: and(
      eq(employeeCredentials.companyId, companyId),
      eq(employeeCredentials.userId, targetUserId)
    ),
  });

  if (!credential) return false;

  await db
    .update(employeeCredentials)
    .set({
      pinHash: await hashPin(newPin),
      failedAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(employeeCredentials.id, credential.id));

  // Revoke every live session for the employee.
  await db
    .delete(employeeSessions)
    .where(eq(employeeSessions.userId, targetUserId));

  return true;
};
