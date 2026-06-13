import { cache } from "react";

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import {
  companySettings,
  employeeCredentials,
  employeeInvites,
  userProgress,
} from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { DEFAULT_LANGUAGE } from "@/lib/content/languages";
import { scoped } from "@/shared/db/scoped";

/** Crew roster (item 5): members + pending invites for the company. */

export type CrewMember = {
  userId: string;
  username: string;
  displayName: string;
  locked: boolean;
  /** Chosen content language, or null = inherit the company primary. */
  language: string | null;
};

export type PendingInvite = {
  id: string;
  username: string;
  displayName: string;
  url: string;
};

export const getCrewRoster = cache(async () => {
  const session = await getSession();
  if (!session || session.role === "employee") {
    return {
      members: [] as CrewMember[],
      invites: [] as PendingInvite[],
      primaryLanguage: DEFAULT_LANGUAGE as string,
    };
  }

  return scoped(session, async (tx) => {
    const members = await tx.query.employeeCredentials.findMany({
      where: eq(employeeCredentials.companyId, session.companyId),
      orderBy: [asc(employeeCredentials.displayName)],
    });

    const invites = await tx.query.employeeInvites.findMany({
      where: and(
        eq(employeeInvites.companyId, session.companyId),
        isNull(employeeInvites.usedAt),
        gt(employeeInvites.expiresAt, sql`now()`)
      ),
      orderBy: [asc(employeeInvites.createdAt)],
    });

    // Per-member language preference (nullable) + the company primary, so the
    // roster can show each member's choice and default the rest.
    const progressRows = await tx.query.userProgress.findMany({
      where: eq(userProgress.companyId, session.companyId),
      columns: { userId: true, language: true },
    });
    const languageByUser = new Map(
      progressRows.map((row) => [row.userId, row.language])
    );

    const settings = await tx.query.companySettings.findFirst({
      where: eq(companySettings.companyId, session.companyId),
      columns: { primaryLanguage: true },
    });
    const primaryLanguage = settings?.primaryLanguage ?? DEFAULT_LANGUAGE;

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

    return {
      primaryLanguage,
      members: members.map((m) => ({
        userId: m.userId,
        username: m.username,
        displayName: m.displayName,
        locked: m.lockedUntil !== null && m.lockedUntil.getTime() > Date.now(),
        language: languageByUser.get(m.userId) ?? null,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        username: i.username,
        displayName: i.displayName,
        url: `${base}/invite/${i.id}`,
      })),
    };
  });
});
