import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { marketplaceListings } from "@/db/schema";
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

describe.skipIf(!enabled)(
  "marketplace_listings bespoke RLS (public read / owner write)",
  () => {
    const companyA = `mk-a-${randomUUID().slice(0, 8)}`;
    const companyB = `mk-b-${randomUUID().slice(0, 8)}`;
    let ctx: ReturnType<typeof makeDb>;
    let publishedId: string;
    let unlistedId: string;

    beforeAll(async () => {
      ctx = makeDb();
      const made = await withTenant(ctx.db, companyA, async (tx) => {
        const [pub] = await tx
          .insert(marketplaceListings)
          .values({
            kind: "COMMUNITY",
            sourceCompanyId: companyA,
            category: "safety",
            title: "A published",
            snapshot: {},
            status: "PUBLISHED",
            publishedBy: "t",
          })
          .returning();
        const [unl] = await tx
          .insert(marketplaceListings)
          .values({
            kind: "COMMUNITY",
            sourceCompanyId: companyA,
            category: "safety",
            title: "A unlisted",
            snapshot: {},
            status: "UNLISTED",
            publishedBy: "t",
          })
          .returning();
        return { publishedId: pub.id, unlistedId: unl.id };
      });
      publishedId = made.publishedId;
      unlistedId = made.unlistedId;
    });

    afterAll(async () => {
      await ctx?.pool.end();
    });

    it("another company CAN read a PUBLISHED listing", async () => {
      const rows = await withTenant(ctx.db, companyB, (tx) =>
        tx
          .select()
          .from(marketplaceListings)
          .where(eq(marketplaceListings.id, publishedId))
      );
      expect(rows).toHaveLength(1);
    });

    it("another company CANNOT read an UNLISTED listing", async () => {
      const rows = await withTenant(ctx.db, companyB, (tx) =>
        tx
          .select()
          .from(marketplaceListings)
          .where(eq(marketplaceListings.id, unlistedId))
      );
      expect(rows).toHaveLength(0);
    });

    it("the owner CAN read its own UNLISTED listing", async () => {
      const rows = await withTenant(ctx.db, companyA, (tx) =>
        tx
          .select()
          .from(marketplaceListings)
          .where(eq(marketplaceListings.id, unlistedId))
      );
      expect(rows).toHaveLength(1);
    });

    it("another company CANNOT update someone else's listing", async () => {
      const updated = await withTenant(ctx.db, companyB, (tx) =>
        tx
          .update(marketplaceListings)
          .set({ title: "hijacked" })
          .where(eq(marketplaceListings.id, publishedId))
          .returning({ id: marketplaceListings.id })
      );
      expect(updated).toHaveLength(0);

      const [row] = await withTenant(ctx.db, companyA, (tx) =>
        tx
          .select()
          .from(marketplaceListings)
          .where(eq(marketplaceListings.id, publishedId))
      );
      expect(row.title).toBe("A published");
    });

    it("a company CANNOT publish a listing claiming another company as source", async () => {
      await expect(
        withTenant(ctx.db, companyB, (tx) =>
          tx.insert(marketplaceListings).values({
            kind: "COMMUNITY",
            sourceCompanyId: companyA,
            category: "safety",
            title: "smuggled",
            snapshot: {},
            status: "PUBLISHED",
            publishedBy: "t",
          })
        )
      ).rejects.toThrow();
    });
  }
);

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
