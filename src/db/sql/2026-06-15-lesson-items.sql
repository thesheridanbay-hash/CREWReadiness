-- ============================================================================
-- Lesson anatomy — Phase 2 foundation DDL (ordered teach items + translations).
-- Apply as the OWNER role, then re-run db/rls.sql so the two new tables get
-- ENABLE + FORCE RLS + tenant_isolation and the app_runtime grants.
-- Idempotent: safe to re-run.
--
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/sql/2026-06-15-lesson-items.sql --split-semicolons
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/rls.sql --split-semicolons
-- ============================================================================

-- Teach-item kind. Stored as a pg enum (closed set, unlike `lang`); guarded so
-- the CREATE is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lesson_item_kind') THEN
    CREATE TYPE lesson_item_kind AS ENUM (
      'teaching', 'image_pair', 'voice_note', 'narrative'
    );
  END IF;
END $$;

-- Ordered, typed teach items shown before the quiz. `payload` is the per-kind
-- content (primary language + media FKs), zod-validated at the app boundary.
CREATE TABLE IF NOT EXISTS lesson_items (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  lesson_id integer NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  "order" integer NOT NULL,
  kind lesson_item_kind NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_items_lesson_order_uq
  ON lesson_items (lesson_id, "order");

-- Per-language text for a lesson_item (mirrors lesson_translations). `fields`
-- holds only the translatable payload keys in `lang`; media is shared.
CREATE TABLE IF NOT EXISTS lesson_item_translations (
  id serial PRIMARY KEY,
  company_id text NOT NULL,
  lesson_item_id integer NOT NULL REFERENCES lesson_items(id) ON DELETE CASCADE,
  lang text NOT NULL,
  fields jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_item_translations_item_lang_uq
  ON lesson_item_translations (lesson_item_id, lang);
