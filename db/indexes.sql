-- ============================================================================
-- Reporting indexes (T9/D21, T13/D25). Apply after the schema, idempotent.
--   psql "$DATABASE_URL_OWNER" -f db/indexes.sql
-- Live aggregates (no rollup tables) lean on these; EXPLAIN should show index
-- scans for the weak-concept and usage queries.
-- ============================================================================

-- Weak-concept + completion reports walk attempts by question and by user.
CREATE INDEX IF NOT EXISTS attempts_question_correct_idx
  ON attempts (question_id, correct);
CREATE INDEX IF NOT EXISTS attempts_company_user_idx
  ON attempts (company_id, user_id);
CREATE INDEX IF NOT EXISTS attempts_company_created_idx
  ON attempts (company_id, created_at);

-- Per-company AI spend is summed by month.
CREATE INDEX IF NOT EXISTS ai_usage_company_created_idx
  ON ai_usage_events (company_id, created_at);

-- Coaching queue scans parked concepts by company + status.
CREATE INDEX IF NOT EXISTS parked_company_status_idx
  ON parked_concepts (company_id, status);

-- Notifications list per recipient, newest first.
CREATE INDEX IF NOT EXISTS notifications_company_user_idx
  ON notifications (company_id, user_id, created_at);
