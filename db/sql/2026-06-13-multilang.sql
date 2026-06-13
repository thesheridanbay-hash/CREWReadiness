-- ============================================================================
-- Multi-language courses — Phase 1 / PR-A foundation DDL.
-- Apply as the OWNER role, then re-run db/rls.sql so the three new translation
-- tables get ENABLE + FORCE RLS + tenant_isolation and the app_runtime grants.
-- Idempotent: safe to re-run.
--
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/sql/2026-06-13-multilang.sql --split-semicolons
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/rls.sql --split-semicolons
-- ============================================================================

-- Company primary language; existing rows backfill to English (back-compat).
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS primary_language text NOT NULL DEFAULT 'en';

-- Crew member's preferred language; NULL = inherit the company primary.
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS language text;

-- Per-language lesson content (base row holds the primary language).
CREATE TABLE IF NOT EXISTS lesson_translations (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  lesson_id integer NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  lang text NOT NULL,
  title text,
  teaching_text text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_translations_lesson_lang_uq
  ON lesson_translations (lesson_id, lang);

-- Per-language question content.
CREATE TABLE IF NOT EXISTS question_translations (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  question_id integer NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  lang text NOT NULL,
  question text NOT NULL,
  explanation text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS question_translations_question_lang_uq
  ON question_translations (question_id, lang);

-- Per-language answer-option text (correctness stays on the base row only).
CREATE TABLE IF NOT EXISTS option_translations (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  option_id integer NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  lang text NOT NULL,
  text text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS option_translations_option_lang_uq
  ON option_translations (option_id, lang);
