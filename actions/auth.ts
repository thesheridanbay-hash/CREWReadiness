"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  acceptEmployeeInvite,
  createEmployeeInvite,
  employeeSignIn,
  employeeSignOut,
  resetEmployeePin,
} from "@/lib/auth/employee";
import { PIN_PATTERN } from "@/lib/auth/pin";
import { getSession } from "@/lib/auth/session";
import { err, fromZod, guard, ok, type Result } from "@/lib/errors";

/**
 * Employee auth actions (T2 — D4). Envelope-wrapped (T7). Manager/owner-only
 * actions verify the caller's role from the session — never from input.
 */

const requestIp = async (): Promise<string> => {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
};

/* ── Sign in ── */

const signInSchema = z.object({
  companyId: z.string().min(1, "Company is required."),
  username: z.string().min(1, "Username is required."),
  pin: z.string().regex(PIN_PATTERN, "PIN must be 4-6 digits."),
});

export const employeeSignInAction = async (
  input: z.infer<typeof signInSchema>
): Promise<Result<null>> =>
  guard(async () => {
    const parsed = signInSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const result = await employeeSignIn(
      parsed.data.companyId,
      parsed.data.username,
      parsed.data.pin,
      await requestIp()
    );

    if (!result.ok) {
      if (result.reason === "rate_limited")
        return err("forbidden", "Too many attempts. Try again in a few minutes.");
      if (result.reason === "locked")
        return err(
          "forbidden",
          "Account locked after too many failed attempts. Ask your manager to reset your PIN, or try again later."
        );
      return err("unauthorized", "Wrong username or PIN.");
    }

    redirect("/learn");
    return ok(null);
  });

/* ── Sign out / user switch (shared crew phones) ── */

export const employeeSignOutAction = async (): Promise<Result<null>> =>
  guard(async () => {
    await employeeSignOut();
    redirect("/sign-in");
    return ok(null);
  });

/* ── Invites (owner/manager only) ── */

const inviteSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9._-]+$/i, "Letters, numbers, dots, dashes only."),
  displayName: z.string().min(1).max(64),
});

export const createEmployeeInviteAction = async (
  input: z.infer<typeof inviteSchema>
): Promise<Result<{ inviteId: string; inviteUrl: string }>> =>
  guard(async () => {
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const session = await getSession();

    if (!session) return err("unauthorized", "Sign in to continue.");
    if (session.role !== "owner" && session.role !== "manager")
      return err("forbidden", "Only owners and managers can invite employees.");

    const invite = await createEmployeeInvite(
      session.companyId,
      parsed.data.username,
      parsed.data.displayName,
      session.userId
    );

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

    return ok({
      inviteId: invite.id,
      inviteUrl: `${base}/invite/${invite.id}`,
    });
  });

/* ── Invite acceptance (public link, unguessable id) ── */

const acceptSchema = z.object({
  inviteId: z.string().uuid(),
  pin: z.string().regex(PIN_PATTERN, "PIN must be 4-6 digits."),
});

export const acceptEmployeeInviteAction = async (
  input: z.infer<typeof acceptSchema>
): Promise<Result<null>> =>
  guard(async () => {
    const parsed = acceptSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const result = await acceptEmployeeInvite(
      parsed.data.inviteId,
      parsed.data.pin
    );

    if (!result.ok) {
      if (result.reason === "username_taken")
        return err("conflict", "That username is already in use at this company.");
      return err("not_found", "This invite link is invalid or has expired.");
    }

    redirect("/sign-in?invited=1");
    return ok(null);
  });

/* ── Manager PIN reset (D4) ── */

const resetSchema = z.object({
  targetUserId: z.string().min(1),
  newPin: z.string().regex(PIN_PATTERN, "PIN must be 4-6 digits."),
});

export const resetEmployeePinAction = async (
  input: z.infer<typeof resetSchema>
): Promise<Result<null>> =>
  guard(async () => {
    const parsed = resetSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const session = await getSession();

    if (!session) return err("unauthorized", "Sign in to continue.");
    if (session.role !== "owner" && session.role !== "manager")
      return err("forbidden", "Only owners and managers can reset PINs.");

    const done = await resetEmployeePin(
      session.companyId,
      parsed.data.targetUserId,
      parsed.data.newPin
    );

    if (!done) return err("not_found", "Employee not found in your company.");

    revalidatePath("/");
    return ok(null);
  });
