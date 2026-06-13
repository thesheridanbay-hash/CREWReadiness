import { sql } from "drizzle-orm";

import db from "@/db/drizzle";
import type { Session } from "@/features/auth/session";

/**
 * Tenant-scoped query layer (T1 — D14/D20).
 *
 * Every feature query runs inside a transaction that first sets
 * `app.company_id` via set_config(..., is_local => true) — the parameterized
 * equivalent of SET LOCAL, so the setting dies with the transaction. RLS
 * policies (db/rls.sql) compare company_id to that setting and fail closed:
 * no context → zero rows.
 *
 * Request path:  scoped(session, tx => ...)
 * Job path:      scopedForJob(jobId, (tx, companyId) => ...) — tenant resolved
 *                from the DB-verified ai_jobs row via SECURITY DEFINER
 *                function, never from event payloads (F2).
 */

/** TODO(T7): fold into the typed error envelope. */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

type TransactionCallback = Parameters<typeof db.transaction>[0];
export type ScopedTx = Parameters<TransactionCallback>[0];

const setTenantContext = async (
  tx: ScopedTx,
  companyId: string,
  isPlatform: boolean
) => {
  await tx.execute(
    sql`SELECT set_config('app.company_id', ${companyId}, true)`
  );
  if (isPlatform) {
    await tx.execute(sql`SELECT set_config('app.is_platform', 'true', true)`);
  }
};

/**
 * Run `fn` inside a tenant-scoped transaction for the given session.
 * Throws TenantContextError when the session carries no company — fail
 * closed, never fall through to an unscoped query.
 */
export async function scoped<T>(
  session: Session | null | undefined,
  fn: (tx: ScopedTx) => Promise<T>
): Promise<T> {
  if (!session?.companyId) {
    throw new TenantContextError(
      "scoped() requires an authenticated session with a companyId"
    );
  }

  return db.transaction(async (tx) => {
    await setTenantContext(tx, session.companyId, session.role === "platform");
    return fn(tx);
  });
}

/**
 * Run `fn` inside a tenant-scoped transaction for a background job. The
 * companyId comes from the ai_jobs row (resolved by unguessable UUID through
 * a SECURITY DEFINER function) — event payloads are never trusted for tenant
 * identity (D20/F2).
 */
export async function scopedForJob<T>(
  jobId: string,
  fn: (tx: ScopedTx, companyId: string) => Promise<T>
): Promise<T> {
  if (!jobId) {
    throw new TenantContextError("scopedForJob() requires a job id");
  }

  const result = await db.execute<{ company_id: string | null }>(
    sql`SELECT app_get_job_company(${jobId}::uuid) AS company_id`
  );
  const companyId = result.rows[0]?.company_id;

  if (!companyId) {
    throw new TenantContextError(
      `scopedForJob(): no ai_jobs row found for job ${jobId}`
    );
  }

  return db.transaction(async (tx) => {
    await setTenantContext(tx, companyId, false);
    return fn(tx, companyId);
  });
}
