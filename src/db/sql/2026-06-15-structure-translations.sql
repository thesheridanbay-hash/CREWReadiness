-- ============================================================================
-- Course + unit title translations (multi-language). The learner's Learn screen
-- shows the course title + unit banner titles/descriptions, which are
-- course-structure (not lesson content) and so need their own side tables.
-- Apply as the OWNER role, then re-run db/rls.sql for FORCE RLS + grants.
-- Idempotent.
--
--   node --env-file=.env scripts/run-sql.mjs \
--     src/db/sql/2026-06-15-structure-translations.sql src/db/rls.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS course_translations (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  course_id integer NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lang text NOT NULL,
  title text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS course_translations_course_lang_uq
  ON course_translations (course_id, lang);

CREATE TABLE IF NOT EXISTS unit_translations (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  unit_id integer NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  lang text NOT NULL,
  title text NOT NULL,
  description text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_translations_unit_lang_uq
  ON unit_translations (unit_id, lang);
