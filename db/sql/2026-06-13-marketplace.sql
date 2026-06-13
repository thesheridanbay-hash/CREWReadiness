-- ============================================================================
-- Course marketplace — PR-1 foundation DDL.
-- Apply as the OWNER role, then re-run db/rls.sql so marketplace_adoptions gets
-- tenant_isolation, marketplace_listings gets its bespoke policies, and
-- app_get_public_media is (re)created. Idempotent: safe to re-run.
--
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/sql/2026-06-13-marketplace.sql --split-semicolons
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/rls.sql --split-semicolons
-- ============================================================================

-- Shared-asset flag: cross-tenant readable (via app_get_public_media) when a
-- course is published to the marketplace. Existing rows stay private.
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS "public" boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marketplace_listing_kind') THEN
    CREATE TYPE marketplace_listing_kind AS ENUM ('COMMUNITY', 'UNIVERSAL');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marketplace_listing_status') THEN
    CREATE TYPE marketplace_listing_status AS ENUM ('PUBLISHED', 'UNLISTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind marketplace_listing_kind NOT NULL,
  source_company_id text,
  source_course_id integer REFERENCES courses(id) ON DELETE SET NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  primary_language text NOT NULL DEFAULT 'en',
  snapshot jsonb NOT NULL,
  status marketplace_listing_status NOT NULL DEFAULT 'PUBLISHED',
  published_by text NOT NULL,
  published_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_adoptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  listing_id uuid REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  adopted_course_id integer REFERENCES courses(id) ON DELETE CASCADE,
  adopted_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Browse-by-category + "my published listings" read paths.
CREATE INDEX IF NOT EXISTS marketplace_listings_category_idx
  ON marketplace_listings (category, status);
CREATE INDEX IF NOT EXISTS marketplace_listings_source_company_idx
  ON marketplace_listings (source_company_id);
CREATE INDEX IF NOT EXISTS marketplace_adoptions_company_idx
  ON marketplace_adoptions (company_id);
