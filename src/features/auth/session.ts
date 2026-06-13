import "server-only";

import { cache } from "react";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import db from "@/db/drizzle";
import { member } from "@/db/schema";

import { auth } from "./auth";
import { getEmployeeSession } from "./employee";

/**
 * Unified session resolution (T2 — D3/D4/D11). Replaces the P0 stub with the
 * same claim shape: { userId, companyId, role } + display fields.
 *
 * Resolution order:
 *   1. Better Auth session (owner / manager / platform; email+password)
 *      - platform owners: user.platformOwner flag
 *      - company + role from the organization membership
 *   2. Employee session (username+PIN credential path; short idle expiry)
 *   3. DEV bypass — ONLY when DEV_AUTH_BYPASS="true" (local dev without auth
 *      setup; never enable in production)
 */

export type SessionRole = "platform" | "owner" | "manager" | "employee";

export type Session = {
  userId: string;
  companyId: string;
  role: SessionRole;
  name: string;
  imageSrc: string;
};

const DEFAULT_IMAGE = "/mascot.svg";

const mapMemberRole = (role: string): SessionRole =>
  role === "owner" || role === "admin" ? "owner" : "manager";

export const getSession = cache(async (): Promise<Session | null> => {
  /* 1 — Better Auth (owner / manager / platform). */
  const baSession = await auth.api.getSession({
    headers: await headers(),
  });

  if (baSession?.user) {
    const { user } = baSession;

    // Active organization if set on the session, else first membership.
    const memberships = await db.query.member.findMany({
      where: eq(member.userId, user.id),
      limit: 1,
    });

    const activeOrgId =
      (baSession.session as { activeOrganizationId?: string | null })
        .activeOrganizationId ?? memberships[0]?.organizationId;

    const isPlatform =
      (user as { platformOwner?: boolean | null }).platformOwner === true;

    if (isPlatform) {
      return {
        userId: user.id,
        // Platform owners may operate without a company context; tenant
        // queries still require one, platform-area queries set app.is_platform.
        companyId: activeOrgId ?? "",
        role: "platform",
        name: user.name || "Platform Owner",
        imageSrc: user.image || DEFAULT_IMAGE,
      };
    }

    if (!activeOrgId) return null; // Authenticated but company-less: no tenant access.

    return {
      userId: user.id,
      companyId: activeOrgId,
      role: mapMemberRole(memberships[0]?.role ?? "member"),
      name: user.name || "User",
      imageSrc: user.image || DEFAULT_IMAGE,
    };
  }

  /* 2 — Employee session (PIN path). */
  const employee = await getEmployeeSession();

  if (employee) {
    return {
      userId: employee.userId,
      companyId: employee.companyId,
      role: "employee",
      name: employee.displayName,
      imageSrc: DEFAULT_IMAGE,
    };
  }

  /* 3 — Explicit dev bypass — inert in production even if the env var leaks. */
  if (
    process.env.DEV_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return {
      userId: "dev-user",
      companyId: "dev-company",
      role: "owner",
      name: "Dev User",
      imageSrc: DEFAULT_IMAGE,
    };
  }

  return null;
});
