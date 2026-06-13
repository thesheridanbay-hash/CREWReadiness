import { sql } from "drizzle-orm";

import db from "@/db/drizzle";
import { notifications } from "@/db/schema";
import { needsRetraining } from "@/features/learning/decay";

import { inngest } from "../client";

/**
 * Decay scan (P5 — D13): the scheduled Decay/Correct step of the memory loop.
 * Weekly, per company, it flags concepts whose miss rate has decayed past the
 * retrain threshold and notifies owners/managers — the retraining trigger.
 *
 * Runs only once Inngest is connected (cron trigger). It iterates companies
 * via the auth-infra `organization` table (not RLS-scoped) and writes each
 * company's notifications inside a transaction pinned to that company's
 * context, so every insert still satisfies RLS.
 *
 * NOTE: trainee-generated scenarios and bilingual image-pair generation (the
 * other P5 items) require the AI provider + image generation and are deferred
 * until those are configured — tracked in TODOS.md.
 */
export const decayScan = inngest.createFunction(
  {
    id: "decay-scan",
    triggers: [{ cron: "TZ=America/New_York 0 8 * * 1" }], // Mondays 8am ET
  },
  async ({ step }) => {
    const companies = await step.run("list-companies", async () => {
      const result = await db.execute<{ id: string }>(
        sql`SELECT id FROM organization`
      );
      return result.rows.map((row) => row.id);
    });

    let flagged = 0;

    for (const companyId of companies) {
      flagged += await step.run(`scan-${companyId}`, async () =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.company_id', ${companyId}, true)`
          );

          const stats = await tx.execute<{
            question_id: number;
            question: string;
            lesson_id: number;
            attempts: number;
            wrong: number;
          }>(sql`
            SELECT q.id AS question_id, q.question, q.lesson_id,
                   count(a.id)::int AS attempts,
                   count(a.id) FILTER (WHERE NOT a.correct)::int AS wrong
            FROM questions q
            JOIN attempts a ON a.question_id = q.id
            GROUP BY q.id, q.question, q.lesson_id
          `);

          const decayed = stats.rows.filter((row) =>
            needsRetraining({
              questionId: row.question_id,
              attempts: row.attempts,
              wrong: row.wrong,
            })
          );

          for (const concept of decayed) {
            // One open retrain flag per question (avoid weekly duplicates).
            const existing = await tx.execute<{ id: number }>(sql`
              SELECT id FROM notifications
              WHERE company_id = ${companyId}
                AND type = 'concept_decayed'
                AND (payload->>'questionId')::int = ${concept.question_id}
                AND read_at IS NULL
              LIMIT 1
            `);
            if (existing.rows.length > 0) continue;

            // Notify the company's owners/admins.
            const managers = await tx.execute<{ user_id: string }>(sql`
              SELECT user_id FROM member
              WHERE organization_id = ${companyId}
                AND role IN ('owner', 'admin')
            `);

            for (const manager of managers.rows) {
              await tx.insert(notifications).values({
                companyId,
                userId: manager.user_id,
                type: "concept_decayed",
                payload: {
                  questionId: concept.question_id,
                  lessonId: concept.lesson_id,
                  missRate: Math.round((concept.wrong / concept.attempts) * 100),
                  question: concept.question.slice(0, 200),
                },
              });
            }
          }

          return decayed.length;
        })
      );
    }

    return { companies: companies.length, flaggedConcepts: flagged };
  }
);
