import { cache } from "react";

import { sql } from "drizzle-orm";

import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";

/**
 * Reporting (T9 — D21): live SQL aggregates over the append-only attempts log.
 * No rollup counters, no nightly batch — purpose-built indexes (db/indexes.sql)
 * keep these fast.
 */

export type WeakConcept = {
  questionId: number;
  question: string;
  lesson: string;
  attempts: number;
  wrong: number;
  missRate: number;
};

export type EmployeeProgress = {
  userId: string;
  name: string;
  questionsMastered: number;
  totalAttempts: number;
  parked: number;
};

export const getWeakConcepts = cache(async (): Promise<WeakConcept[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  return scoped(session, async (tx) => {
    const result = await tx.execute<{
      question_id: number;
      question: string;
      lesson: string;
      attempts: number;
      wrong: number;
    }>(sql`
      SELECT q.id AS question_id, q.question, l.title AS lesson,
             count(a.id)::int AS attempts,
             count(a.id) FILTER (WHERE NOT a.correct)::int AS wrong
      FROM attempts a
      JOIN questions q ON q.id = a.question_id
      JOIN lessons l ON l.id = q.lesson_id
      GROUP BY q.id, q.question, l.title
      HAVING count(a.id) FILTER (WHERE NOT a.correct) > 0
      ORDER BY count(a.id) FILTER (WHERE NOT a.correct) DESC
      LIMIT 25
    `);

    return result.rows.map((row) => ({
      questionId: row.question_id,
      question: row.question,
      lesson: row.lesson,
      attempts: row.attempts,
      wrong: row.wrong,
      missRate: row.attempts > 0 ? Math.round((row.wrong / row.attempts) * 100) : 0,
    }));
  });
});

export const getEmployeeProgress = cache(async (): Promise<EmployeeProgress[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  return scoped(session, async (tx) => {
    const result = await tx.execute<{
      user_id: string;
      name: string | null;
      mastered: number;
      total_attempts: number;
      parked: number;
    }>(sql`
      SELECT ec.user_id,
             ec.display_name AS name,
             count(DISTINCT a.question_id) FILTER (WHERE a.correct)::int AS mastered,
             count(a.id)::int AS total_attempts,
             COALESCE(pk.parked, 0)::int AS parked
      FROM employee_credentials ec
      LEFT JOIN attempts a ON a.user_id = ec.user_id
      LEFT JOIN (
        SELECT user_id, count(*) AS parked
        FROM parked_concepts WHERE status = 'PARKED'
        GROUP BY user_id
      ) pk ON pk.user_id = ec.user_id
      WHERE ec.company_id = ${session.companyId}
      GROUP BY ec.user_id, ec.display_name, pk.parked
      ORDER BY ec.display_name
    `);

    return result.rows.map((row) => ({
      userId: row.user_id,
      name: row.name ?? "Crew member",
      questionsMastered: row.mastered,
      totalAttempts: row.total_attempts,
      parked: row.parked,
    }));
  });
});
