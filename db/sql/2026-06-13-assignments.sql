-- ============================================================================
-- Assignments go-live (A1): due date + required flag on the existing
-- assignments table. assignments is already a tenant table with
-- tenant_isolation (db/rls.sql), so no policy change is needed. Idempotent.
--
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/sql/2026-06-13-assignments.sql --split-semicolons
-- ============================================================================

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS due_date timestamp;

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true;
