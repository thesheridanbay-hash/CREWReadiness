-- ============================================================================
-- Billing go-live (B): subscriptions table. Apply as OWNER, then re-run
-- db/rls.sql so subscriptions gets tenant_isolation (owner reads) and the
-- app_upsert_subscription SECURITY DEFINER is created (webhook writes).
-- Idempotent.
--
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/sql/2026-06-13-billing.sql --split-semicolons
--   python3 skills/neon/run_sql.py --url "$OWNER_URL" \
--     --file db/rls.sql --split-semicolons
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  company_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_ends_at timestamp,
  current_period_end timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);
