import { cache } from "react";

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import { employeeCredentials, employeeInvites } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/** Crew roster (item 5): members + pending invites for the company. */

export type CrewMember = {
  userId: string;
  username: string;
  displayName: string;
  locked: boolean;
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
    return { members: [] as CrewMember[], invites: [] as PendingInvite[] };
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

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

    return {
      members: members.map((m) => ({
        userId: m.userId,
        username: m.username,
        displayName: m.displayName,
        locked: m.lockedUntil !== null && m.lockedUntil.getTime() > Date.now(),
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
