import { sql } from "drizzle-orm";

import { aiUsageEvents } from "@/db/schema";

import type { AiContext, AiOperation, Usage } from "./types";

/**
 * Per-company AI usage metering (T4 — D5/D25).
 *
 * Metering rides the caller's scoped transaction: if the operation's work
 * commits, its usage row commits with it (worst case on partial failure is
 * an undercount — PLAN §10). Threshold alerts are in-app notifications; the
 * platform-owner usage surface consumes them in P4.
 */

export const recordUsage = async (
  ctx: AiContext,
  operation: AiOperation,
  provider: string,
  usage: Usage,
  alertThresholdUsd: number | null
): Promise<void> => {
  await ctx.tx.insert(aiUsageEvents).values({
    companyId: ctx.companyId,
    jobId: ctx.jobId,
    operation,
    provider,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd.toFixed(4),
  });

  if (alertThresholdUsd === null || alertThresholdUsd <= 0) return;

  const result = await ctx.tx.execute<{ month_spend: string | null }>(sql`
    SELECT sum(cost_usd)::text AS month_spend
    FROM ai_usage_events
    WHERE company_id = ${ctx.companyId}
      AND created_at >= date_trunc('month', now())
  `);

  const monthSpend = Number(result.rows[0]?.month_spend ?? 0);

  if (monthSpend >= alertThresholdUsd) {
    // Once per threshold-month. Single guarded INSERT (review finding #7):
    // the partial unique index notifications_ai_threshold_month_uq
    // (db/rls.sql) makes concurrent inserts collide; ON CONFLICT swallows
    // the duplicate instead of failing the metering transaction.
    await ctx.tx.execute(sql`
      INSERT INTO notifications (company_id, user_id, type, payload)
      SELECT ${ctx.companyId}, 'platform', 'ai_usage_threshold',
             ${JSON.stringify({ monthSpendUsd: monthSpend, thresholdUsd: alertThresholdUsd })}::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications
        WHERE company_id = ${ctx.companyId}
          AND type = 'ai_usage_threshold'
          AND created_at >= date_trunc('month', now())
      )
      ON CONFLICT DO NOTHING
    `);
    // TODO(P4): route to the platform-owner surface; "platform" is the
    // sentinel recipient until that area exists.
  }
};
