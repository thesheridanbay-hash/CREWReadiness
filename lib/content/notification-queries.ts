import { cache } from "react";

import { desc, eq, sql } from "drizzle-orm";

import { notifications } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Notification reads (go-live A2). The app already WRITES notifications (e.g.
 * concept_parked to managers); this surfaces them. Per-user, scoped.
 */

export type NotificationItem = {
  id: number;
  type: string;
  message: string;
  href: string;
  read: boolean;
  createdAt: Date;
};

/** Map a notification type to learner/owner-friendly copy + a destination. */
const describe = (type: string): { message: string; href: string } => {
  switch (type) {
    case "concept_parked":
      return {
        message: "A crew member is stuck on a concept and needs coaching.",
        href: "/coaching",
      };
    case "ai_usage_threshold":
      return {
        message: "AI usage crossed your alert threshold.",
        href: "/reports",
      };
    default:
      return { message: "You have a new notification.", href: "/" };
  }
};

export type MyNotifications = {
  items: NotificationItem[];
  unread: number;
};

export const getMyNotifications = cache(async (): Promise<MyNotifications> => {
  const session = await getSession();
  if (!session) return { items: [], unread: 0 };

  return scoped(session, async (tx) => {
    const rows = await tx.query.notifications.findMany({
      where: eq(notifications.userId, session.userId),
      orderBy: [desc(notifications.createdAt)],
      limit: 20,
    });

    const unreadResult = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM notifications
      WHERE user_id = ${session.userId} AND read_at IS NULL
    `);

    const items: NotificationItem[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      ...describe(row.type),
      read: row.readAt !== null,
      createdAt: row.createdAt,
    }));

    return { items, unread: unreadResult.rows[0]?.n ?? 0 };
  });
});
