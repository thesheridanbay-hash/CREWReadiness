import { cache } from "react";

import { and, eq, sql } from "drizzle-orm";

import { parkedConcepts } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/** Coaching queue (T12 — D23): parked concepts awaiting in-person coaching. */

export type ParkedItem = {
  id: number;
  employeeName: string;
  questionText: string;
  lessonTitle: string;
  createdAt: string;
};

export const getParkedConcepts = cache(async (): Promise<ParkedItem[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  return scoped(session, async (tx) => {
    // Join question + lesson for context, and employee_credentials for a name.
    const result = await tx.execute<{
      id: number;
      question_text: string;
      lesson_title: string;
      created_at: string;
      employee_name: string | null;
    }>(sql`
      SELECT pc.id,
             q.question AS question_text,
             l.title AS lesson_title,
             pc.created_at,
             ec.display_name AS employee_name
      FROM parked_concepts pc
      JOIN questions q ON q.id = pc.question_id
      JOIN lessons l ON l.id = pc.lesson_id
      LEFT JOIN employee_credentials ec ON ec.user_id = pc.user_id
      WHERE pc.status = 'PARKED'
      ORDER BY pc.created_at ASC
    `);

    return result.rows.map((row) => ({
      id: row.id,
      employeeName: row.employee_name ?? "Crew member",
      questionText: row.question_text,
      lessonTitle: row.lesson_title,
      createdAt: row.created_at,
    }));
  });
});

export const getParkedCount = cache(async (): Promise<number> => {
  const session = await getSession();
  if (!session || session.role === "employee") return 0;

  return scoped(session, async (tx) => {
    const result = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(parkedConcepts)
      .where(
        and(
          eq(parkedConcepts.companyId, session.companyId),
          eq(parkedConcepts.status, "PARKED")
        )
      );
    return result[0]?.n ?? 0;
  });
});
