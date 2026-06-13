import { cache } from "react";

import { sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { scoped } from "@/shared/db/scoped";

/**
 * AI usage surfaces (T13 — D25). Per-company spend for owners; cross-company
 * for the platform owner. Metering + alerts only — no hard enforcement at
 * launch (PLAN §9).
 */

export type CompanyUsage = {
  monthSpendUsd: number;
  monthInputTokens: number;
  monthOutputTokens: number;
  byOperation: { operation: string; calls: number; costUsd: number }[];
};

export const getCompanyUsage = cache(async (): Promise<CompanyUsage> => {
  const session = await getSession();
  const empty: CompanyUsage = {
    monthSpendUsd: 0,
    monthInputTokens: 0,
    monthOutputTokens: 0,
    byOperation: [],
  };
  if (!session || session.role === "employee") return empty;

  return scoped(session, async (tx) => {
    const totals = await tx.execute<{
      spend: string;
      input_tokens: number;
      output_tokens: number;
    }>(sql`
      SELECT COALESCE(SUM(cost_usd), 0) AS spend,
             COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM ai_usage_events
      WHERE created_at >= date_trunc('month', now())
    `);

    const byOp = await tx.execute<{ operation: string; calls: number; cost: string }>(sql`
      SELECT operation, count(*)::int AS calls, COALESCE(SUM(cost_usd), 0) AS cost
      FROM ai_usage_events
      WHERE created_at >= date_trunc('month', now())
      GROUP BY operation
      ORDER BY SUM(cost_usd) DESC
    `);

    return {
      monthSpendUsd: Number(totals.rows[0]?.spend ?? 0),
      monthInputTokens: totals.rows[0]?.input_tokens ?? 0,
      monthOutputTokens: totals.rows[0]?.output_tokens ?? 0,
      byOperation: byOp.rows.map((row) => ({
        operation: row.operation,
        calls: row.calls,
        costUsd: Number(row.cost),
      })),
    };
  });
});

export type PlatformUsageRow = {
  companyId: string;
  monthSpendUsd: number;
  calls: number;
};

/** Cross-company usage (platform owner only). */
export const getPlatformUsage = cache(async (): Promise<PlatformUsageRow[]> => {
  const session = await getSession();
  if (!session || session.role !== "platform") return [];

  return scoped(session, async (tx) => {
    // ai_usage_events is tenant-scoped, so a plain SELECT would only see the
    // platform owner's own company. app_platform_usage() is a SECURITY DEFINER
    // aggregate that bypasses per-row RLS but self-guards on app.is_platform
    // (set only for platform sessions) — real cross-company totals, safely.
    const result = await tx.execute<{
      company_id: string;
      spend: string;
      calls: string | number;
    }>(sql`SELECT * FROM app_platform_usage()`);

    return result.rows.map((row) => ({
      companyId: row.company_id,
      monthSpendUsd: Number(row.spend),
      calls: Number(row.calls),
    }));
  });
});
