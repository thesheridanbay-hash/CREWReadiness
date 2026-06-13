-- ============================================================================
-- Course archive/delete (soft-delete). Adds courses.archived_at. courses is
-- already a tenant table with tenant_isolation — no policy change. Idempotent.
--
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/sql/2026-06-13-course-archive.sql --split-semicolons
-- ============================================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS archived_at timestamp;
