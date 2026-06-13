"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { notifications } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/lib/errors";

/**
 * Notification actions (go-live A2). A user can only mark THEIR OWN
 * notifications read (userId filter on top of RLS).
 */

const markSchema = z.object({ id: z.number().int().positive() });

export const markNotificationRead = async (
  input: unknown
): Promise<Result<null>> =>
  guard(async () => {
    const parsed = markSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await getSession();
    if (!auth) return err("unauthorized", "Sign in to continue.");

    await scoped(auth, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, parsed.data.id),
            eq(notifications.userId, auth.userId)
          )
        )
    );
    revalidatePath("/");
    return ok(null);
  });

export const markAllNotificationsRead = async (): Promise<Result<null>> =>
  guard(async () => {
    const auth = await getSession();
    if (!auth) return err("unauthorized", "Sign in to continue.");

    await scoped(auth, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, auth.userId),
            isNull(notifications.readAt)
          )
        )
    );
    revalidatePath("/");
    return ok(null);
  });
