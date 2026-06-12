-- ============================================================================
-- CREWReadiness Row-Level Security setup (T1 — PLAN.md D14/D20, findings F1/F2)
--
-- RUN AS: the database OWNER role (e.g. Neon's default owner), AFTER
-- `npm run db:push` has created the tables.
--
-- Architecture (fail-closed by construction):
--   * Migrations run as the OWNER role (db:push / drizzle-kit).
--   * The APP runs as `app_runtime` — a separate role that:
--       - is NOT the table owner,
--       - has NO BYPASSRLS attribute,
--       - only has CRUD grants.
--   * Every tenant table has ENABLE + FORCE ROW LEVEL SECURITY and a policy
--     comparing company_id to current_setting('app.company_id', true).
--     When the setting is missing, current_setting(..., true) returns NULL,
--     `company_id = NULL` is never true, and ZERO rows are visible/writable.
--     A connection without tenant context therefore reads and writes nothing.
--   * Background jobs resolve their tenant via app_get_job_company(job_id)
--     (SECURITY DEFINER) from a DB-verified ai_jobs row — never from event
--     payloads (D20/F2).
--
-- Setup steps:
--   1. In Neon: create role `app_runtime` with LOGIN + password
--      (Neon console → Roles, or: CREATE ROLE app_runtime LOGIN PASSWORD '...';)
--   2. Run this file as the owner role:  psql "$DATABASE_URL_OWNER" -f db/rls.sql
--   3. Point the app's DATABASE_URL at app_runtime; keep DATABASE_URL_OWNER
--      for migrations only.
--   4. Re-run this file after any migration that adds a tenant table (the
--      loop below picks tables up by name — add new ones to tenant_tables).
-- ============================================================================

-- ─── 1. Runtime role grants (role itself created in Neon, step 1 above) ────

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- Defense in depth: the runtime role must never own tables or bypass RLS.
ALTER ROLE app_runtime NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- ─── 2. FORCE RLS + tenant-isolation policy on every tenant table ──────────
--
-- NOT in this list (auth infrastructure — reads happen before tenant context
-- exists, only via lib/auth/* code paths):
--   Better Auth: "user", session, account, verification, organization,
--                member, invitation
--   Employee:    employee_credentials, employee_sessions, employee_invites,
--                employee_login_attempts

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'courses',
    'content_versions',
    'modules',
    'units',
    'lessons',
    'questions',
    'question_options',
    'question_variants',
    'learning_sessions',
    'attempts',
    'parked_concepts',
    'crews',
    'crew_members',
    'assignments',
    'tags',
    'lesson_tags',
    'media_assets',
    'ai_jobs',
    'ai_usage_events',
    'review_queue',
    'notifications',
    'user_progress'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE applies RLS even to the table owner (F1: belt and braces).
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (company_id = current_setting(''app.company_id'', true)) '
      || 'WITH CHECK (company_id = current_setting(''app.company_id'', true))',
      t
    );
  END LOOP;
END $$;

-- ─── 3. provider_settings: platform-owner scope only (D5/D25) ──────────────

ALTER TABLE provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON provider_settings;
CREATE POLICY platform_only ON provider_settings
  USING (current_setting('app.is_platform', true) = 'true')
  WITH CHECK (current_setting('app.is_platform', true) = 'true');

-- ─── 4. Job tenant resolution (D20/F2) ─────────────────────────────────────
-- SECURITY DEFINER so the runtime role can resolve a job's company WITHOUT
-- tenant context (chicken-and-egg: ai_jobs itself is RLS'd). Resolves from a
-- DB-verified row by unguessable UUID; returns NULL for unknown ids.

CREATE OR REPLACE FUNCTION app_get_job_company(p_job_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM ai_jobs WHERE id = p_job_id
$$;

REVOKE ALL ON FUNCTION app_get_job_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_get_job_company(uuid) TO app_runtime;

-- ─── 5. Verification (run these; both must hold) ───────────────────────────
-- a) Runtime role must NOT bypass RLS (CI asserts this in T5):
--      SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
--      WHERE rolname = 'app_runtime';
--    Expect: rolbypassrls = f, rolsuper = f
--
-- b) Every tenant table is FORCE-RLS'd with a policy:
--      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
--             count(p.polname) AS policies
--      FROM pg_class c
--      LEFT JOIN pg_policy p ON p.polrelid = c.oid
--      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
--      GROUP BY 1, 2, 3
--      ORDER BY 1;
--    Expect: relrowsecurity = t, relforcerowsecurity = t, policies >= 1
--    for every tenant table listed above.
--
-- c) Fail-closed smoke test (as app_runtime, no setting):
--      SELECT count(*) FROM courses;   -- expect 0 regardless of data
