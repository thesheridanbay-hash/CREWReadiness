import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TENANT_TABLES, TENANT_TABLE_NAMES } from "@/db/tenant-tables";

import { makeDb, seedCompany, testDatabaseUrl, withTenant } from "./fixtures";

/**
 * Table-driven RLS isolation suite (T5 — D14/D18, outside-voice F1).
 *
 * Runs only when DATABASE_URL_TEST points at a database that has the schema
 * (npm run db:push) AND db/rls.sql applied, connected as a NON-OWNER role
 * (CI uses a fresh Neon branch + the app_runtime role).
 *
 * For every tenant table:
 *   1. company B's context must see ZERO of company A's rows
 *   2. NO tenant context must see ZERO rows (fail-closed)
 *   3. cross-tenant writes must be rejected (WITH CHECK)
 * Plus: policy coverage (every registered table is FORCE-RLS'd with a
 * policy) and the one-active-session unique index.
 */

const enabled = Boolean(testDatabaseUrl());

describe.skipIf(!enabled)("RLS tenant isolation (request path)", () => {
  const companyA = `co-a-${randomUUID().slice(0, 8)}`;
  const companyB = `co-b-${randomUUID().slice(0, 8)}`;
  let ctx: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    ctx = makeDb();
    await seedCompany(ctx.db, companyA);
    await seedCompany(ctx.db, companyB);
  });

  afterAll(async () => {
    await ctx?.pool.end();
  });

  for (const name of TENANT_TABLE_NAMES) {
    const table = TENANT_TABLES[name];

    it(`${name}: tenant B cannot read tenant A rows`, async () => {
      const rows = await withTenant(ctx.db, companyB, (tx) =>
        tx
          .select()
          .from(table)
          .where(sql`${table.companyId} = ${companyA}`)
      );
      expect(rows).toHaveLength(0);
    });

    it(`${name}: no tenant context reads zero rows (fail-closed)`, async () => {
      const rows = await withTenant(ctx.db, null, (tx) =>
        tx.select().from(table).limit(5)
      );
      expect(rows).toHaveLength(0);
    });
  }

  it("WITH CHECK rejects cross-tenant writes (spot check on notifications)", async () => {
    await expect(
      withTenant(ctx.db, companyB, (tx) =>
        tx.execute(
          sql`INSERT INTO notifications (company_id, user_id, type) VALUES (${companyA}, 'x', 'smuggled')`
        )
      )
    ).rejects.toThrow();
  });

  it("policy coverage: every registered tenant table is FORCE-RLS'd with a policy", async () => {
    const result = await ctx.db.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: number;
    }>(sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             count(p.polname)::int AS policies
      FROM pg_class c
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
      GROUP BY 1, 2, 3
    `);

    const byName = new Map(result.rows.map((r) => [r.relname, r]));

    for (const name of TENANT_TABLE_NAMES) {
      const row = byName.get(name);
      expect(row, `${name} missing from database`).toBeDefined();
      expect(row?.relrowsecurity, `${name} RLS not enabled`).toBe(true);
      expect(row?.relforcerowsecurity, `${name} RLS not FORCEd`).toBe(true);
      expect(row?.policies ?? 0, `${name} has no policy`).toBeGreaterThan(0);
    }
  });

  it("one ACTIVE learning session per user+lesson is enforced", async () => {
    const seeded = await withTenant(ctx.db, companyA, (tx) =>
      tx.query.learningSessions.findFirst()
    );
    expect(seeded).toBeDefined();
    if (!seeded) return;

    await expect(
      withTenant(ctx.db, companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO learning_sessions
            (company_id, user_id, lesson_id, content_version_id, status)
          VALUES
            (${companyA}, ${seeded.userId}, ${seeded.lessonId},
             ${seeded.contentVersionId}, 'ACTIVE')
        `)
      )
    ).rejects.toThrow();
  });
});

describe.skipIf(!enabled)("runtime role posture (D14/F1)", () => {
  it("the connected role has neither BYPASSRLS nor SUPERUSER", async () => {
    const ctx = makeDb();
    try {
      const result = await ctx.db.execute<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        sql`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`
      );

      const role = result.rows[0];
      expect(role).toBeDefined();
      expect(role?.rolbypassrls, `${role?.rolname} must not BYPASSRLS`).toBe(
        false
      );
      expect(role?.rolsuper, `${role?.rolname} must not be superuser`).toBe(
        false
      );
    } finally {
      await ctx.pool.end();
    }
  });
});
