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
import { recordCorrectAnswer } from "@/actions/challenge-progress";
import { upsertUserProgress } from "@/actions/user-progress";

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
    name: "recordCorrectAnswer rejects invalid input",
    run: () => recordCorrectAnswer(-5),
    session: ownerSession,
    expectCode: "validation",
  },
  {
    name: "recordCorrectAnswer requires a session",
    run: () => recordCorrectAnswer(1),
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
    it("recordCorrectAnswer succeeds against seeded content", async () => {
      const { makeDb, seedCompany } = await import("./fixtures");
      const { sql } = await import("drizzle-orm");
      const ctx = makeDb();

      try {
        const seeded = await seedCompany(ctx.db, `co-act-${Date.now()}`);

        const questionRow = await ctx.db.execute<{ id: number }>(
          sql`SELECT id FROM questions WHERE company_id = ${seeded.companyId} LIMIT 1`
        );
        const questionId = questionRow.rows[0]?.id;
        expect(questionId).toBeDefined();

        sessionState.current = {
          userId: seeded.userId,
          companyId: seeded.companyId,
          role: "employee",
          name: "Seeded",
          imageSrc: "/mascot.svg",
        };

        const result = await recordCorrectAnswer(questionId!);
        expect(result.ok).toBe(true);
      } finally {
        await ctx.pool.end();
      }
    });
  }
);
