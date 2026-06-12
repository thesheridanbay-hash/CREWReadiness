/**
 * Learning-loop contract — FROZEN in P0 (PLAN.md D17/D23, §4).
 *
 * This file is the interface between the lesson player (Lane A / P1), the
 * variant pipeline (Lane C / P3), and the state machine implementation
 * (lib/learning-loop/machine.ts, T3). Both lanes compile against these types.
 *
 * DO NOT change shapes here without an eng review — downstream worktrees
 * depend on this exact contract. Additive changes only until all P1–P3 lanes
 * have merged.
 */

/* ─────────────────────────── Session ─────────────────────────── */

export type SessionStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

/**
 * Where the learner currently is for the active question.
 *
 * QUESTION      — awaiting an answer (original or variant question surface)
 * EXPLAIN       — wrong once: static "why" from the lesson, then retry
 * AI_RETEACH    — wrong twice+: streamed simpler-angle reteach (leak-guarded),
 *                 then a variant is served
 * CONCEPT_PARKED— reteach cycle cap hit: concept parked for in-person coaching,
 *                 manager flagged, learner advances to the next question/lesson
 */
export type StepKind = "QUESTION" | "EXPLAIN" | "AI_RETEACH" | "CONCEPT_PARKED";

export type LearningLoopSession = {
  id: string;
  /** Tenant + identity (D14): every persisted row carries companyId. */
  companyId: string;
  userId: string;
  lessonId: number;
  /**
   * Sessions pin to a content version at start (D17/D22). Publishing
   * mid-session never corrupts state: the session finishes on the pinned
   * version.
   */
  contentVersionId: number;
  status: SessionStatus;
  /** The question currently being worked (null once COMPLETED/ABANDONED). */
  activeQuestionId: number | null;
  /** Which surface of the active question is being shown. */
  step: StepKind;
  /** Reteach cycles consumed for the active question (parks at the cap). */
  reteachCycle: number;
  startedAt: Date;
  updatedAt: Date;
};

/* ─────────────────────────── Events ─────────────────────────── */

/**
 * Every event carries an idempotency key: double-submits (flaky field signal,
 * two devices) must not double-apply (PLAN §10).
 */
type BaseEvent = {
  sessionId: string;
  idempotencyKey: string;
};

export type AnswerSubmitted = BaseEvent & {
  type: "ANSWER_SUBMITTED";
  questionId: number;
  /** The option chosen for the question/variant surface being shown. */
  optionId: number;
  correct: boolean;
};

export type ExplainAcknowledged = BaseEvent & {
  type: "EXPLAIN_ACKNOWLEDGED";
  questionId: number;
};

export type ReteachCompleted = BaseEvent & {
  type: "RETEACH_COMPLETED";
  questionId: number;
  /** How the reteach content was produced (D7 fallback chain). */
  source: "LIVE_STREAM" | "PREGENERATED_VARIANT_FALLBACK";
};

export type SessionAbandoned = BaseEvent & {
  type: "SESSION_ABANDONED";
  reason: "IDLE_EXPIRY" | "USER_EXIT";
};

export type SessionResumed = BaseEvent & {
  type: "SESSION_RESUMED";
};

export type LearningLoopEvent =
  | AnswerSubmitted
  | ExplainAcknowledged
  | ReteachCompleted
  | SessionAbandoned
  | SessionResumed;

/* ─────────────────────── Transition results ─────────────────────── */

/**
 * Commands the machine emits for the caller to execute (persist attempt,
 * stream a reteach, serve a variant, flag a manager, ...). The machine itself
 * is pure (D17): no I/O inside transitions.
 */
export type LoopEffect =
  | { kind: "PERSIST_ATTEMPT"; questionId: number; correct: boolean }
  | { kind: "AWARD_POINTS"; amount: number }
  | { kind: "EMIT_WEAK_CONCEPT"; questionId: number }
  | { kind: "START_RETEACH_STREAM"; questionId: number; cycle: number }
  | { kind: "SERVE_VARIANT"; questionId: number; cycle: number }
  | { kind: "PARK_CONCEPT"; questionId: number }
  | { kind: "FLAG_MANAGER"; questionId: number }
  | { kind: "COMPLETE_SESSION" };

export type TransitionOk = {
  ok: true;
  session: LearningLoopSession;
  effects: LoopEffect[];
};

/**
 * Illegal transitions return a typed error (never throw) so the UI can offer
 * a reset (PLAN §10 "Illegal transitions → typed error → reset offer").
 */
export type TransitionError = {
  ok: false;
  code:
    | "ILLEGAL_TRANSITION"
    | "SESSION_NOT_ACTIVE"
    | "STALE_QUESTION"
    | "DUPLICATE_EVENT"
    | "RETEACH_CAP_EXHAUSTED";
  message: string;
};

export type TransitionResult = TransitionOk | TransitionError;

/* ─────────────────────── Transition context ─────────────────────── */

/**
 * Read-model inputs the machine needs but must not fetch itself (the machine
 * is pure — D17). The caller assembles these from the database before calling
 * transition(). ADDITIVE to the frozen contract.
 */
export type TransitionContext = {
  /** Next question in lesson order after the active one; null = none left. */
  nextQuestionId: number | null;
  /** Prior persisted WRONG attempts for the active question by this user. */
  priorWrongAttempts: number;
  /**
   * False when the per-question daily live-reteach budget is exhausted
   * (LOOP_CONFIG.RETEACH_CALLS_PER_QUESTION_PER_DAY) — the machine then
   * falls back to serving a pre-generated variant directly (D7).
   */
  reteachAvailableToday: boolean;
};

/* ─────────────────────────── Config ─────────────────────────── */

export const LOOP_CONFIG = {
  /** D23: reteach cycles per question before the concept parks. */
  RETEACH_CYCLE_CAP: 3,
  /** D23: live reteach calls per question per user per day (cost guard). */
  RETEACH_CALLS_PER_QUESTION_PER_DAY: 5,
  /** Idle expiry that moves a session to ABANDONED (resume-safe). */
  IDLE_EXPIRY_MINUTES: 30,
  /** Points awarded per correct answer (carried over from base UX). */
  POINTS_PER_CORRECT: 10,
} as const;
