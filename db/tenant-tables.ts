import {
  aiJobs,
  aiUsageEvents,
  assignments,
  attempts,
  companySettings,
  contentVersions,
  courseAssets,
  courses,
  crewMembers,
  crews,
  learningSessions,
  lessonTags,
  lessonTranslations,
  lessons,
  marketplaceAdoptions,
  mediaAssets,
  modules,
  notifications,
  optionTranslations,
  parkedConcepts,
  questionOptions,
  questionTranslations,
  questionVariants,
  questions,
  reviewQueue,
  subscriptions,
  tags,
  units,
  userProgress,
} from "./schema";

/**
 * Canonical tenant-table registry (T1/T5 — D14).
 *
 * Single source of truth consumed by the table-driven RLS isolation tests.
 * MUST stay in sync with the tenant_tables array in db/rls.sql — the
 * policy-coverage integration test asserts every name here has
 * ENABLE + FORCE RLS and a tenant_isolation policy in the live database.
 *
 * Add new tenant tables to BOTH places (and re-run db/rls.sql).
 */
export const TENANT_TABLES = {
  courses,
  content_versions: contentVersions,
  modules,
  units,
  lessons,
  lesson_translations: lessonTranslations,
  questions,
  question_options: questionOptions,
  question_translations: questionTranslations,
  option_translations: optionTranslations,
  question_variants: questionVariants,
  learning_sessions: learningSessions,
  attempts,
  parked_concepts: parkedConcepts,
  crews,
  crew_members: crewMembers,
  assignments,
  tags,
  lesson_tags: lessonTags,
  media_assets: mediaAssets,
  ai_jobs: aiJobs,
  ai_usage_events: aiUsageEvents,
  review_queue: reviewQueue,
  notifications,
  user_progress: userProgress,
  company_settings: companySettings,
  course_assets: courseAssets,
  marketplace_adoptions: marketplaceAdoptions,
  subscriptions,
} as const;

export const TENANT_TABLE_NAMES = Object.keys(
  TENANT_TABLES
) as Array<keyof typeof TENANT_TABLES>;
