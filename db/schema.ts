import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Multi-tenant schema (T1, PLAN.md §3 / D14 / D20).
 *
 * Conventions:
 * - Every tenant table carries `companyId` (text) and is covered by a
 *   fail-closed RLS policy — see db/rls.sql. `provider_settings` is the one
 *   platform-scoped exception (D5/D25).
 * - `companyId`/`userId` are text: they will reference Better Auth's
 *   organization/user tables once T2 lands (FKs added then — Better Auth owns
 *   those tables).
 * - Content ids are serial ints (internal, player-facing). Session/job/media
 *   ids are UUIDs (externally referenced, unguessable).
 * - `ai_jobs` is the tenant anchor for background work: jobs resolve their
 *   companyId from a DB-verified row via app_get_job_company(), never from
 *   event payloads (D20, outside-voice F2).
 */

/* ───────────────────────── Content hierarchy ───────────────────────── */

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  title: text("title").notNull(),
  imageSrc: text("image_src").notNull().default("/mascot.svg"),
  activeContentVersionId: integer("active_content_version_id").references(
    (): AnyPgColumn => contentVersions.id,
    { onDelete: "set null" }
  ),
});

export const contentVersions = pgTable(
  "content_versions",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    courseId: integer("course_id")
      .references(() => courses.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
    publishedBy: text("published_by").notNull(),
  },
  (t) => [
    uniqueIndex("content_versions_course_version_uq").on(t.courseId, t.version),
  ]
);

export const modules = pgTable("modules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  courseId: integer("course_id")
    .references(() => courses.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  order: integer("order").notNull(),
});

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  moduleId: integer("module_id")
    .references(() => modules.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  order: integer("order").notNull(),
});

export const lessons = pgTable("lessons", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  unitId: integer("unit_id")
    .references(() => units.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  /**
   * Plain-language teaching text shown before the questions (AI Course
   * Builder). Nullable: hand-authored lessons and pre-builder content have
   * none, and the player renders questions-only when it's absent.
   */
  teachingText: text("teaching_text"),
  order: integer("order").notNull(),
});

export const questionTypeEnum = pgEnum("question_type", ["SELECT", "ASSIST"]);

export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  lessonId: integer("lesson_id")
    .references(() => lessons.id, { onDelete: "cascade" })
    .notNull(),
  type: questionTypeEnum("type").notNull(),
  question: text("question").notNull(),
  /** Static "why" shown on the first wrong answer (EXPLAIN step, D7). */
  explanation: text("explanation"),
  order: integer("order").notNull(),
});

export const questionOptions = pgTable("question_options", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  questionId: integer("question_id")
    .references(() => questions.id, { onDelete: "cascade" })
    .notNull(),
  text: text("text").notNull(),
  correct: boolean("correct").notNull(),
  imageSrc: text("image_src"),
  audioSrc: text("audio_src"),
});

/** Pre-generated retest bank (D7): same concept, new surface. Regenerated on publish. */
export const questionVariants = pgTable("question_variants", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  questionId: integer("question_id")
    .references(() => questions.id, { onDelete: "cascade" })
    .notNull(),
  contentVersionId: integer("content_version_id").references(
    () => contentVersions.id,
    { onDelete: "cascade" }
  ),
  prompt: text("prompt").notNull(),
  options: jsonb("options")
    .$type<Array<{ text: string; correct: boolean }>>()
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ─────────────── Content translations (multi-language) ─────────────── */

/**
 * On-demand multi-language COURSE CONTENT (Phase 1, doc cmqc9bav705c207add).
 *
 * Base rows (lessons/questions/question_options) always hold the company's
 * PRIMARY language (back-compat: single-language courses need zero rows
 * here). These side tables hold every OTHER language, keyed by `lang`
 * (validated against lib/content/languages.ts — plain text, no enum, so a new
 * language needs no DDL). Learner reads pick their language and fall back to
 * the primary/English when a row is missing — never blank.
 *
 * Tenant-scoped like all content (companyId + FORCE RLS, db/rls.sql). One row
 * per (parent, lang). Translations are produced on demand by the PR-B
 * translate backend; images stay SHARED across languages (no lang here).
 */
export const lessonTranslations = pgTable(
  "lesson_translations",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    lessonId: integer("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    lang: text("lang").notNull(),
    /** Translated lesson title (base row holds the primary-language title). */
    title: text("title"),
    /** Translated teaching brief shown before the questions (Learn screen). */
    teachingText: text("teaching_text"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lesson_translations_lesson_lang_uq").on(t.lessonId, t.lang),
  ]
);

export const questionTranslations = pgTable(
  "question_translations",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    questionId: integer("question_id")
      .references(() => questions.id, { onDelete: "cascade" })
      .notNull(),
    lang: text("lang").notNull(),
    /** Translated prompt text (base row holds the primary-language prompt). */
    question: text("question").notNull(),
    /** Translated "why" shown on the first wrong answer (EXPLAIN step). */
    explanation: text("explanation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("question_translations_question_lang_uq").on(
      t.questionId,
      t.lang
    ),
  ]
);

export const optionTranslations = pgTable(
  "option_translations",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    optionId: integer("option_id")
      .references(() => questionOptions.id, { onDelete: "cascade" })
      .notNull(),
    lang: text("lang").notNull(),
    /** Translated answer text (correctness lives only on the base row). */
    text: text("text").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("option_translations_option_lang_uq").on(t.optionId, t.lang),
  ]
);

/* ───────────────────────── Learning loop ───────────────────────── */

export const learningSessionStatusEnum = pgEnum("learning_session_status", [
  "ACTIVE",
  "COMPLETED",
  "ABANDONED",
]);

export const learningStepEnum = pgEnum("learning_step", [
  "QUESTION",
  "EXPLAIN",
  "AI_RETEACH",
  "CONCEPT_PARKED",
]);

export const learningSessions = pgTable(
  "learning_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    userId: text("user_id").notNull(),
    lessonId: integer("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    /** Sessions pin to a content version at start (D17/D22). */
    contentVersionId: integer("content_version_id").notNull(),
    status: learningSessionStatusEnum("status").notNull().default("ACTIVE"),
    activeQuestionId: integer("active_question_id").references(
      () => questions.id,
      { onDelete: "set null" }
    ),
    step: learningStepEnum("step").notNull().default("QUESTION"),
    reteachCycle: integer("reteach_cycle").notNull().default(0),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    /** One active session per user+lesson (PLAN §10). */
    uniqueIndex("learning_sessions_one_active_uq")
      .on(t.userId, t.lessonId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ]
);

export const attemptSurfaceEnum = pgEnum("attempt_surface", [
  "ORIGINAL",
  "VARIANT",
]);

/** Append-only answer log; feeds weak-concept reports (D21). */
export const attempts = pgTable(
  "attempts",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    userId: text("user_id").notNull(),
    /** Nullable until T3 reshapes the player onto persisted sessions. */
    sessionId: uuid("session_id").references(() => learningSessions.id, {
      onDelete: "set null",
    }),
    questionId: integer("question_id")
      .references(() => questions.id, { onDelete: "cascade" })
      .notNull(),
    variantId: integer("variant_id").references(() => questionVariants.id, {
      onDelete: "set null",
    }),
    surface: attemptSurfaceEnum("surface").notNull().default("ORIGINAL"),
    correct: boolean("correct").notNull(),
    cycle: integer("cycle").notNull().default(0),
    /** Double-submit guard (PLAN §10): unique when present. */
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attempts_idempotency_uq")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ]
);

export const parkedStatusEnum = pgEnum("parked_status", [
  "PARKED",
  "COACHED",
  "RESOLVED",
]);

/** D23 park-and-continue: manager resolution queue. */
export const parkedConcepts = pgTable("parked_concepts", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  userId: text("user_id").notNull(),
  questionId: integer("question_id")
    .references(() => questions.id, { onDelete: "cascade" })
    .notNull(),
  lessonId: integer("lesson_id")
    .references(() => lessons.id, { onDelete: "cascade" })
    .notNull(),
  sessionId: uuid("session_id").references(() => learningSessions.id, {
    onDelete: "set null",
  }),
  status: parkedStatusEnum("status").notNull().default("PARKED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
});

/* ───────────────────────── Org & assignment ───────────────────────── */

export const crews = pgTable("crews", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
});

export const crewMembers = pgTable(
  "crew_members",
  {
    crewId: integer("crew_id")
      .references(() => crews.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id").notNull(),
    companyId: text("company_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.userId] })]
);

/** Employee/crew × course (exactly one target per row). */
export const assignments = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    courseId: integer("course_id")
      .references(() => courses.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id"),
    crewId: integer("crew_id").references(() => crews.id, {
      onDelete: "cascade",
    }),
    assignedBy: text("assigned_by").notNull(),
    /** Optional completion deadline; null = no due date. Overdue is computed. */
    dueDate: timestamp("due_date"),
    /** Required training (vs optional/self-serve). Default required. */
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "assignments_exactly_one_target",
      sql`(${t.userId} IS NULL) <> (${t.crewId} IS NULL)`
    ),
    uniqueIndex("assignments_user_course_uq")
      .on(t.courseId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("assignments_crew_course_uq")
      .on(t.courseId, t.crewId)
      .where(sql`${t.crewId} IS NOT NULL`),
  ]
);

/** Reusable manual: tag library (D16). */
export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_company_name_uq").on(t.companyId, t.name)]
);

export const lessonTags = pgTable(
  "lesson_tags",
  {
    lessonId: integer("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    tagId: integer("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
    companyId: text("company_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.tagId] })]
);

/* ───────────────────────── Media & AI pipeline ───────────────────────── */

export const mediaKindEnum = pgEnum("media_kind", ["PHOTO", "VOICE", "VIDEO"]);

/** Vercel Blob objects (D9/D12): EXIF-stripped, access via authed proxy (T11). */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  pathname: text("pathname").notNull(),
  contentType: text("content_type").notNull(),
  kind: mediaKindEnum("kind").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  /**
   * Cross-tenant readable when true (course marketplace): set when the owning
   * course is published to the marketplace, so adopters' course_assets can
   * reference the SAME blob instead of copying/regenerating. Durable — stays
   * public if the listing is later unlisted, so existing adopters don't break.
   * The ONLY cross-tenant read path is app_get_public_media() (db/rls.sql);
   * the media proxy still requires an authed session. Default private.
   */
  public: boolean("public").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const aiJobKindEnum = pgEnum("ai_job_kind", [
  "TEXT_TO_TRAINING",
  "VOICE_TO_TRAINING",
  "PHOTO_TO_TRAINING",
  "VARIANT_PREGEN",
  "DECAY_SCAN",
  /** AI Course Builder: full-course text generation → review queue. */
  "GENERATE_COURSE",
  /** Sequential image fill for an approved course (icon + lesson art). */
  "GENERATE_COURSE_ASSETS",
]);

export const aiJobStatusEnum = pgEnum("ai_job_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
]);

/** Tenant anchor for background work (D20): scopedForJob() resolves companyId here. */
export const aiJobs = pgTable("ai_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull(),
  kind: aiJobKindEnum("kind").notNull(),
  status: aiJobStatusEnum("status").notNull().default("PENDING"),
  mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, {
    onDelete: "set null",
  }),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Per-company metering (D5/D25); alerts read from here. */
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  jobId: uuid("job_id").references(() => aiJobs.id, { onDelete: "set null" }),
  operation: text("operation").notNull(),
  provider: text("provider").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reviewStatusEnum = pgEnum("review_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

/** AI drafts are never auto-published (D6): owner review queue. */
export const reviewQueue = pgTable("review_queue", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  jobId: uuid("job_id").references(() => aiJobs.id, { onDelete: "set null" }),
  courseId: integer("course_id").references(() => courses.id, {
    onDelete: "set null",
  }),
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
  status: reviewStatusEnum("status").notNull().default("PENDING"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** In-app notifications (D24). */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ───────────────── AI Course Builder (course-builder feature) ───────────────── */

/**
 * Per-company owner "master prompt" guidance for the AI Course Builder.
 * Tenant-scoped (one row per company). Composed with the platform site
 * prompt (provider_settings, course_builder row) at generation time. This is
 * owner-authored TRUSTED guidance — it joins the instruction block, while the
 * owner's free-text course idea is sandwiched as DATA (lib/ai/prompts.ts).
 */
export const companySettings = pgTable("company_settings", {
  companyId: text("company_id").primaryKey(),
  masterPrompt: text("master_prompt"),
  /**
   * Company's primary content language (multi-language courses): the language
   * base content rows are authored in, and the default a crew member sees
   * until they pick their own. Plain text (never an enum) so new languages
   * need no DDL — validated against lib/content/languages.ts.
   */
  primaryLanguage: text("primary_language").notNull().default("en"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Course icon, lesson artwork, or a lesson voiceover (AUDIO). ICON rows carry
 * a null lessonId; AUDIO is the spoken teachingText for a lesson. */
export const courseAssetKindEnum = pgEnum("course_asset_kind", [
  "ICON",
  "ILLUSTRATION",
  "REALISTIC",
  "AUDIO",
]);

/**
 * Sequential image-generation queue for a course (D-image). One row per image
 * the builder wants (course icon + per-lesson art). The PR21 pipeline drains
 * PENDING rows ONE AT A TIME, in `order`, so results are reliable rather than
 * a parallel fan-out: PENDING → GENERATING → GENERATED|FAILED. On GENERATED,
 * the row points at a media_assets blob; the icon row also updates
 * courses.imageSrc. Resumable + idempotent by status.
 */
export const courseAssetStatusEnum = pgEnum("course_asset_status", [
  "PENDING",
  "GENERATING",
  "GENERATED",
  "FAILED",
]);

export const courseAssets = pgTable(
  "course_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    courseId: integer("course_id")
      .references(() => courses.id, { onDelete: "cascade" })
      .notNull(),
    /** Null for the course ICON; set for lesson artwork. */
    lessonId: integer("lesson_id").references(() => lessons.id, {
      onDelete: "cascade",
    }),
    /** Stable human ref assigned on ingest (A1, A2, …) for editor commands. */
    ref: text("ref").notNull(),
    kind: courseAssetKindEnum("kind").notNull(),
    prompt: text("prompt").notNull(),
    /** Drain order within the course (icon first, then lessons in tree order). */
    order: integer("order").notNull(),
    status: courseAssetStatusEnum("status").notNull().default("PENDING"),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("course_assets_course_ref_uq").on(t.courseId, t.ref),
  ]
);

/* ───────────────── Course marketplace (marketplace feature) ───────────────── */

/** COMMUNITY = a company published its own course; UNIVERSAL = admin-curated. */
export const marketplaceListingKindEnum = pgEnum("marketplace_listing_kind", [
  "COMMUNITY",
  "UNIVERSAL",
]);

export const marketplaceListingStatusEnum = pgEnum(
  "marketplace_listing_status",
  ["PUBLISHED", "UNLISTED"]
);

/**
 * Public course library. NOT a standard tenant table — it has a BESPOKE RLS
 * policy (db/rls.sql): any company may SELECT PUBLISHED rows (+ its own, +
 * platform sees all); a company may only write its OWN COMMUNITY rows, and
 * only platform writes UNIVERSAL rows.
 *
 * `snapshot` is the frozen, portable course tree (structure + asset media
 * references + translations) serialized at publish time — the ONLY thing that
 * crosses the tenant boundary, and only because the owner chose to publish it.
 * Adopting deserializes it into the adopter's own company (never reads the
 * source company's content tables). `sourceCourseId` is provenance only.
 */
export const marketplaceListings = pgTable("marketplace_listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: marketplaceListingKindEnum("kind").notNull(),
  /** Publisher company (COMMUNITY); null for platform UNIVERSAL listings. */
  sourceCompanyId: text("source_company_id"),
  /** Provenance only — NEVER read on adopt (the snapshot is the source). */
  sourceCourseId: integer("source_course_id").references(() => courses.id, {
    onDelete: "set null",
  }),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  primaryLanguage: text("primary_language").notNull().default("en"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  status: marketplaceListingStatusEnum("status").notNull().default("PUBLISHED"),
  publishedBy: text("published_by").notNull(),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Adoption audit (standard tenant table): one row per time a company adopts a
 * listing into a new course. Powers "already adopted" warnings + provenance.
 */
export const marketplaceAdoptions = pgTable("marketplace_adoptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull(),
  listingId: uuid("listing_id").references(() => marketplaceListings.id, {
    onDelete: "set null",
  }),
  adoptedCourseId: integer("adopted_course_id").references(() => courses.id, {
    onDelete: "cascade",
  }),
  adoptedBy: text("adopted_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ───────────────────────── Billing (Stripe) ───────────────────────── */

/**
 * Per-company subscription (go-live B). One row per company. The OWNER reads it
 * (tenant RLS); the Stripe WEBHOOK writes it without a session via the
 * app_upsert_subscription SECURITY DEFINER (db/rls.sql), resolving the company
 * from Stripe metadata. `status` is plain text (Stripe's status vocabulary +
 * our 'expired'); a 14-day trial is seeded lazily on first owner read.
 */
export const subscriptions = pgTable("subscriptions", {
  companyId: text("company_id").primaryKey(),
  status: text("status").notNull().default("trialing"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEnd: timestamp("current_period_end"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ───────────────────────── User progress ───────────────────────── */

export const userProgress = pgTable("user_progress", {
  userId: text("user_id").primaryKey(),
  companyId: text("company_id").notNull(),
  userName: text("user_name").notNull().default("User"),
  userImageSrc: text("user_image_src").notNull().default("/mascot.svg"),
  activeCourseId: integer("active_course_id").references(() => courses.id, {
    onDelete: "set null",
  }),
  /**
   * Crew member's preferred content language (multi-language courses).
   * NULL = inherit the company primary (company_settings.primaryLanguage);
   * we store null rather than copying the primary so a company that switches
   * its primary carries non-overriding members along. Resolved via
   * resolveReadingLanguage() in lib/content/languages.ts.
   */
  language: text("language"),
  points: integer("points").notNull().default(0),
});

/* ───────────────── Platform-scoped settings (D5/D25) ───────────────── */

/**
 * NOT tenant-scoped: platform owner only. RLS policy requires the
 * `app.is_platform` transaction setting (set by the scoped layer for
 * platform-role sessions only). Key encryption mechanics land in P3.
 */
export const providerSettings = pgTable("provider_settings", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  encryptedKey: text("encrypted_key"),
  settings: jsonb("settings").$type<Record<string, unknown>>(),
  alertThresholdUsd: numeric("alert_threshold_usd", {
    precision: 10,
    scale: 2,
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ──────────────── Employee auth (T2 — D4, auth infrastructure) ──────────────── */

/**
 * Employee credential tables are AUTH INFRASTRUCTURE, not tenant data:
 * sign-in runs before any tenant context exists, so these tables are NOT in
 * the db/rls.sql tenant list (same as Better Auth's own tables). They are
 * only touched by lib/auth/employee.ts code paths.
 *
 * Spike outcome (D4/T2): usernames are unique PER COMPANY (two companies can
 * both have "miguel") — global-unique username plugins can't express that,
 * so employees use this dedicated credential path, per the plan's fallback.
 */
export const employeeCredentials = pgTable(
  "employee_credentials",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(),
    /** App-level user id (e.g. "emp_<uuid>") used across tenant tables. */
    userId: text("user_id").notNull().unique(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    pinHash: text("pin_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_credentials_company_username_uq").on(
      t.companyId,
      t.username
    ),
  ]
);

/** DB-backed employee sessions: short idle expiry, revocable, listable (D4). */
export const employeeSessions = pgTable("employee_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Invite links: owner/manager pre-creates username + display name (D4). */
export const employeeInvites = pgTable("employee_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  createdBy: text("created_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Per-IP sign-in attempt log for rate limiting (D4). Pruned opportunistically. */
export const employeeLoginAttempts = pgTable("employee_login_attempts", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull(),
  attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
});

/* ───────────────────────── Relations ───────────────────────── */

export const coursesRelations = relations(courses, ({ many, one }) => ({
  modules: many(modules),
  contentVersions: many(contentVersions),
  activeContentVersion: one(contentVersions, {
    fields: [courses.activeContentVersionId],
    references: [contentVersions.id],
  }),
  userProgress: many(userProgress),
  assignments: many(assignments),
  assets: many(courseAssets),
}));

export const contentVersionsRelations = relations(
  contentVersions,
  ({ one }) => ({
    course: one(courses, {
      fields: [contentVersions.courseId],
      references: [courses.id],
    }),
  })
);

export const modulesRelations = relations(modules, ({ one, many }) => ({
  course: one(courses, {
    fields: [modules.courseId],
    references: [courses.id],
  }),
  units: many(units),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  module: one(modules, {
    fields: [units.moduleId],
    references: [modules.id],
  }),
  lessons: many(lessons),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  unit: one(units, {
    fields: [lessons.unitId],
    references: [units.id],
  }),
  questions: many(questions),
  lessonTags: many(lessonTags),
  assets: many(courseAssets),
  translations: many(lessonTranslations),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  lesson: one(lessons, {
    fields: [questions.lessonId],
    references: [lessons.id],
  }),
  questionOptions: many(questionOptions),
  variants: many(questionVariants),
  attempts: many(attempts),
  translations: many(questionTranslations),
}));

export const questionOptionsRelations = relations(
  questionOptions,
  ({ one, many }) => ({
    question: one(questions, {
      fields: [questionOptions.questionId],
      references: [questions.id],
    }),
    translations: many(optionTranslations),
  })
);

export const lessonTranslationsRelations = relations(
  lessonTranslations,
  ({ one }) => ({
    lesson: one(lessons, {
      fields: [lessonTranslations.lessonId],
      references: [lessons.id],
    }),
  })
);

export const questionTranslationsRelations = relations(
  questionTranslations,
  ({ one }) => ({
    question: one(questions, {
      fields: [questionTranslations.questionId],
      references: [questions.id],
    }),
  })
);

export const optionTranslationsRelations = relations(
  optionTranslations,
  ({ one }) => ({
    option: one(questionOptions, {
      fields: [optionTranslations.optionId],
      references: [questionOptions.id],
    }),
  })
);

export const questionVariantsRelations = relations(
  questionVariants,
  ({ one }) => ({
    question: one(questions, {
      fields: [questionVariants.questionId],
      references: [questions.id],
    }),
  })
);

export const learningSessionsRelations = relations(
  learningSessions,
  ({ one, many }) => ({
    lesson: one(lessons, {
      fields: [learningSessions.lessonId],
      references: [lessons.id],
    }),
    attempts: many(attempts),
  })
);

export const attemptsRelations = relations(attempts, ({ one }) => ({
  question: one(questions, {
    fields: [attempts.questionId],
    references: [questions.id],
  }),
  session: one(learningSessions, {
    fields: [attempts.sessionId],
    references: [learningSessions.id],
  }),
}));

export const parkedConceptsRelations = relations(parkedConcepts, ({ one }) => ({
  question: one(questions, {
    fields: [parkedConcepts.questionId],
    references: [questions.id],
  }),
  lesson: one(lessons, {
    fields: [parkedConcepts.lessonId],
    references: [lessons.id],
  }),
}));

export const crewsRelations = relations(crews, ({ many }) => ({
  members: many(crewMembers),
  assignments: many(assignments),
}));

export const crewMembersRelations = relations(crewMembers, ({ one }) => ({
  crew: one(crews, {
    fields: [crewMembers.crewId],
    references: [crews.id],
  }),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  course: one(courses, {
    fields: [assignments.courseId],
    references: [courses.id],
  }),
  crew: one(crews, {
    fields: [assignments.crewId],
    references: [crews.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  lessonTags: many(lessonTags),
}));

export const lessonTagsRelations = relations(lessonTags, ({ one }) => ({
  lesson: one(lessons, {
    fields: [lessonTags.lessonId],
    references: [lessons.id],
  }),
  tag: one(tags, {
    fields: [lessonTags.tagId],
    references: [tags.id],
  }),
}));

export const aiJobsRelations = relations(aiJobs, ({ one, many }) => ({
  mediaAsset: one(mediaAssets, {
    fields: [aiJobs.mediaAssetId],
    references: [mediaAssets.id],
  }),
  usageEvents: many(aiUsageEvents),
}));

export const aiUsageEventsRelations = relations(aiUsageEvents, ({ one }) => ({
  job: one(aiJobs, {
    fields: [aiUsageEvents.jobId],
    references: [aiJobs.id],
  }),
}));

export const reviewQueueRelations = relations(reviewQueue, ({ one }) => ({
  job: one(aiJobs, {
    fields: [reviewQueue.jobId],
    references: [aiJobs.id],
  }),
  course: one(courses, {
    fields: [reviewQueue.courseId],
    references: [courses.id],
  }),
}));

export const userProgressRelations = relations(userProgress, ({ one }) => ({
  activeCourse: one(courses, {
    fields: [userProgress.activeCourseId],
    references: [courses.id],
  }),
}));

export const courseAssetsRelations = relations(courseAssets, ({ one }) => ({
  course: one(courses, {
    fields: [courseAssets.courseId],
    references: [courses.id],
  }),
  lesson: one(lessons, {
    fields: [courseAssets.lessonId],
    references: [lessons.id],
  }),
  mediaAsset: one(mediaAssets, {
    fields: [courseAssets.mediaAssetId],
    references: [mediaAssets.id],
  }),
}));

export const marketplaceListingsRelations = relations(
  marketplaceListings,
  ({ many }) => ({
    adoptions: many(marketplaceAdoptions),
  })
);

export const marketplaceAdoptionsRelations = relations(
  marketplaceAdoptions,
  ({ one }) => ({
    listing: one(marketplaceListings, {
      fields: [marketplaceAdoptions.listingId],
      references: [marketplaceListings.id],
    }),
    adoptedCourse: one(courses, {
      fields: [marketplaceAdoptions.adoptedCourseId],
      references: [courses.id],
    }),
  })
);

/* ───────────── Better Auth tables (T2) — re-exported for the db instance ───────────── */

export * from "./auth-schema";
