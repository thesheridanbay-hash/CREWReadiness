import { sql } from "drizzle-orm";

import { lessons, modules, questions, units } from "@/db/schema";
import { getSession, type Session } from "@/features/auth/session";
import { type ScopedTx } from "@/shared/db/scoped";
import { AppActionError } from "@/shared/errors";

/** Office-role gate shared by every content action (owners/managers only). */
export const requireAuthor = async (): Promise<Session> => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError("forbidden", "Only owners and managers can edit content.");
  }
  return auth;
};

/** Next 1-based display order for a child row, computed server-side. */
export const nextOrder = async (
  tx: ScopedTx,
  table: typeof modules | typeof units | typeof lessons | typeof questions,
  column: "course_id" | "module_id" | "unit_id" | "lesson_id",
  parentId: number
): Promise<number> => {
  const result = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX("order"), 0) + 1 AS next
    FROM ${table} WHERE ${sql.raw(column)} = ${parentId}
  `);
  return result.rows[0]?.next ?? 1;
};
