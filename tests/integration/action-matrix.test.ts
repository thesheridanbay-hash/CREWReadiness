import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@/lib/auth/session";

/**
 * Server-action matrix (T5 — D18): every action must prove success,
 * auth-failure, and validation-failure behavior. Rows are generated from the
 * matrix below rather than hand-written per case.
 *
 * Validation and auth-failure rows run WITHOUT a database — zod parsing and
 * session checks short-circuit before any DB call (that ordering is itself
 * part of the contract this suite pins down). Success rows need
 * DATABASE_URL_TEST and are skipped when it is absent.
 */

const sessionState: { current: Session | null } = { current: null };

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureRequestError: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionState.current,
}));

import {
  acceptEmployeeInviteAction,
  createEmployeeInviteAction,
} from "@/actions/auth";
import {
  acknowledgeExplain,
  startOrResumeSession,
  submitAnswer,
} from "@/actions/learning-loop";
import { upsertUserProgress } from "@/actions/user-progress";
import { createCourse, createQuestion, publishCourse } from "@/actions/content";
import {
  adoptListing,
  publishCourseAsUniversal,
  publishCourseToMarketplace,
  unlistListing,
} from "@/actions/marketplace";
import { assignCourse, unassignCourse } from "@/actions/assignments";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/actions/notifications";

const ownerSession: Session = {
  userId: "user-1",
  companyId: "co-1",
  role: "owner",
  name: "Owner",
  imageSrc: "/mascot.svg",
};

const employeeSession: Session = { ...ownerSession, role: "employee" };

type MatrixRow = {
  name: string;
  run: () => Promise<{ ok: boolean; error?: { code: string } }>;
  session: Session | null;
  expectCode: string;
};

/** DB-free rows: validation, auth, and role failures. */
const matrix: MatrixRow[] = [
  {
    name: "startOrResumeSession rejects invalid lesson ids",
    run: () => startOrResumeSession(-1),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "startOrResumeSession requires a session",
    run: () => startOrResumeSession(1),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "submitAnswer rejects malformed payloads",
    run: () =>
      submitAnswer({
        sessionId: "not-a-uuid",
        questionId: 1,
        surface: "ORIGINAL",
        variantId: null,
        optionRef: 0,
        idempotencyKey: "k".repeat(12),
      }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "submitAnswer rejects short idempotency keys",
    run: () =>
      submitAnswer({
        sessionId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910",
        questionId: 1,
        surface: "ORIGINAL",
        variantId: null,
        optionRef: 0,
        idempotencyKey: "abc",
      }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "submitAnswer requires a session",
    run: () =>
      submitAnswer({
        sessionId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910",
        questionId: 1,
        surface: "ORIGINAL",
        variantId: null,
        optionRef: 0,
        idempotencyKey: "k".repeat(12),
      }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "acknowledgeExplain requires a session",
    run: () =>
      acknowledgeExplain({
        sessionId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910",
        questionId: 1,
        idempotencyKey: "k".repeat(12),
      }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "upsertUserProgress rejects invalid input",
    run: () => upsertUserProgress(0),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "upsertUserProgress requires a session",
    run: () => upsertUserProgress(1),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "createEmployeeInvite rejects invalid usernames",
    run: () =>
      createEmployeeInviteAction({ username: "!", displayName: "X" }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "createEmployeeInvite requires a session",
    run: () =>
      createEmployeeInviteAction({ username: "miguel", displayName: "M" }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "createEmployeeInvite is forbidden for employees",
    run: () =>
      createEmployeeInviteAction({ username: "miguel", displayName: "M" }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "acceptEmployeeInvite rejects malformed tokens",
    run: () =>
      acceptEmployeeInviteAction({ inviteId: "not-a-uuid", pin: "1234" }),
    session: null,
    expectCode: "validation",
  },
  {
    name: "acceptEmployeeInvite rejects malformed PINs",
    run: () =>
      acceptEmployeeInviteAction({
        inviteId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910",
        pin: "12",
      }),
    session: null,
    expectCode: "validation",
  },
  {
    name: "createCourse requires a session",
    run: () => createCourse({ title: "Safety 101" }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "createCourse is forbidden for employees",
    run: () => createCourse({ title: "Safety 101" }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "createCourse rejects an empty title",
    run: () => createCourse({ title: "" }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "createQuestion rejects options with no correct answer",
    run: () =>
      createQuestion({
        lessonId: 1,
        type: "SELECT",
        question: "Q?",
        options: [
          { text: "a", correct: false },
          { text: "b", correct: false },
        ],
      }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "createQuestion rejects fewer than two options",
    run: () =>
      createQuestion({
        lessonId: 1,
        type: "SELECT",
        question: "Q?",
        options: [{ text: "only", correct: true }],
      }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "publishCourse is forbidden for employees",
    run: () => publishCourse({ courseId: 1 }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "adoptListing rejects a malformed listing id",
    run: () => adoptListing({ listingId: "not-a-uuid" }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "adoptListing requires a session",
    run: () =>
      adoptListing({ listingId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910" }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "adoptListing is forbidden for employees",
    run: () =>
      adoptListing({ listingId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910" }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "publishCourseToMarketplace rejects an unknown category",
    run: () =>
      publishCourseToMarketplace({
        courseId: 1,
        category: "not-a-category",
        description: "x",
      }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "publishCourseToMarketplace is forbidden for employees",
    run: () =>
      publishCourseToMarketplace({ courseId: 1, category: "safety" }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "publishCourseToMarketplace requires a session",
    run: () =>
      publishCourseToMarketplace({ courseId: 1, category: "safety" }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "unlistListing rejects a malformed id",
    run: () => unlistListing({ listingId: "nope" }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "unlistListing is forbidden for employees",
    run: () =>
      unlistListing({ listingId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910" }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "publishCourseAsUniversal is forbidden for non-platform owners",
    run: () =>
      publishCourseAsUniversal({ courseId: 1, category: "safety" }),
    session: ownerSession,
    expectCode: "forbidden",
  },
  {
    name: "publishCourseAsUniversal rejects an unknown category",
    run: () =>
      publishCourseAsUniversal({ courseId: 1, category: "bogus" }),
    session: { ...ownerSession, role: "platform" },
    expectCode: "validation",
  },
  {
    name: "assignCourse rejects when no target is given",
    run: () => assignCourse({ courseId: 1 }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "assignCourse rejects when both targets are given",
    run: () => assignCourse({ courseId: 1, crewId: 1, userId: "emp_x" }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "assignCourse requires a session",
    run: () => assignCourse({ courseId: 1, crewId: 1 }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "assignCourse is forbidden for employees",
    run: () => assignCourse({ courseId: 1, crewId: 1 }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "unassignCourse rejects a non-positive id",
    run: () => unassignCourse({ assignmentId: 0 }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "unassignCourse is forbidden for employees",
    run: () => unassignCourse({ assignmentId: 1 }),
    session: employeeSession,
    expectCode: "forbidden",
  },
  {
    name: "markNotificationRead rejects a non-positive id",
    run: () => markNotificationRead({ id: 0 }),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "markNotificationRead requires a session",
    run: () => markNotificationRead({ id: 1 }),
    session: null,
    expectCode: "unauthorized",
  },
  {
    name: "markAllNotificationsRead requires a session",
    run: () => markAllNotificationsRead(),
    session: null,
    expectCode: "unauthorized",
  },
];

describe("server-action matrix — validation & auth rows (DB-free)", () => {
  beforeEach(() => {
    sessionState.current = null;
  });

  for (const row of matrix) {
    it(row.name, async () => {
      sessionState.current = row.session;

      const result = await row.run();

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(row.expectCode);
    });
  }
});

describe.skipIf(!process.env.DATABASE_URL_TEST)(
  "server-action matrix — success rows (DB)",
  () => {
    it("full loop: start session, answer correctly, view advances", async () => {
      const { makeDb, seedCompany } = await import("./fixtures");
      const { sql } = await import("drizzle-orm");
      const ctx = makeDb();

      try {
        const seeded = await seedCompany(ctx.db, `co-act-${Date.now()}`);

        sessionState.current = {
          userId: seeded.userId,
          companyId: seeded.companyId,
          role: "employee",
          name: "Seeded",
          imageSrc: "/mascot.svg",
        };

        const started = await startOrResumeSession(
          await ctx.db
            .execute<{ id: number }>(
              sql`SELECT l.id FROM lessons l WHERE l.company_id = ${seeded.companyId} LIMIT 1`
            )
            .then((r) => r.rows[0]!.id)
        );
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        expect(started.data.view.type).toBe("QUESTION");
        if (started.data.view.type !== "QUESTION") return;

        const surface = started.data.view.surface;
        const correctRef = await ctx.db
          .execute<{ id: number }>(
            sql`SELECT id FROM question_options
                WHERE question_id = ${surface.questionId} AND correct LIMIT 1`
          )
          .then((r) => r.rows[0]!.id);

        const answered = await submitAnswer({
          sessionId: started.data.sessionId,
          questionId: surface.questionId,
          surface: "ORIGINAL",
          variantId: null,
          optionRef: correctRef,
          idempotencyKey: `it-${Date.now()}-ok`,
        });

        expect(answered.ok).toBe(true);
        if (!answered.ok) return;
        expect(answered.data.pointsEarned).toBeGreaterThan(0);
        expect(["QUESTION", "COMPLETE"]).toContain(answered.data.view.type);
      } finally {
        await ctx.pool.end();
      }
    });
  }
);
