import "dotenv/config";

import { neonConfig, Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";

/**
 * Dev seed (T1): one landscaping starter course for the dev company so the
 * app is usable before the owner content studio (P2) exists.
 *
 * Sets the tenant context inside its own transaction, so it works with or
 * without RLS applied, under either the owner or runtime role:
 *   npm run db:seed
 *
 * Idempotent: skips if the course already exists.
 */

const COMPANY_ID = "dev-company";
const DEV_USER_ID = "dev-user";

const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;

if (!url) throw new Error("DATABASE_URL_OWNER or DATABASE_URL must be set");

neonConfig.webSocketConstructor = globalThis.WebSocket;

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const main = async () => {
  console.log("Seeding dev content...");

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${COMPANY_ID}, true)`
    );

    const existing = await tx.query.courses.findFirst({
      where: (courses, { and, eq }) =>
        and(
          eq(courses.companyId, COMPANY_ID),
          eq(courses.title, "Landscaping Crew Onboarding")
        ),
    });

    if (existing) {
      console.log("Dev course already seeded — nothing to do.");
      return;
    }

    const [course] = await tx
      .insert(schema.courses)
      .values({
        companyId: COMPANY_ID,
        title: "Landscaping Crew Onboarding",
        imageSrc: "/mascot.svg",
      })
      .returning();

    const [version] = await tx
      .insert(schema.contentVersions)
      .values({
        companyId: COMPANY_ID,
        courseId: course.id,
        version: 1,
        publishedBy: "seed",
      })
      .returning();

    await tx
      .update(schema.courses)
      .set({ activeContentVersionId: version.id })
      .where(sql`${schema.courses.id} = ${course.id}`);

    const [mod] = await tx
      .insert(schema.modules)
      .values({
        companyId: COMPANY_ID,
        courseId: course.id,
        title: "Equipment Safety",
        description: "Operate equipment without hurting yourself or others.",
        order: 1,
      })
      .returning();

    const [unit] = await tx
      .insert(schema.units)
      .values({
        companyId: COMPANY_ID,
        moduleId: mod.id,
        title: "Unit 1: Mower Basics",
        description: "Safe mower operation, every job, every time.",
        order: 1,
      })
      .returning();

    const [lesson1, lesson2] = await tx
      .insert(schema.lessons)
      .values([
        {
          companyId: COMPANY_ID,
          unitId: unit.id,
          title: "Pre-start checks",
          order: 1,
        },
        {
          companyId: COMPANY_ID,
          unitId: unit.id,
          title: "Mowing on slopes",
          order: 2,
        },
      ])
      .returning();

    const questionRows = await tx
      .insert(schema.questions)
      .values([
        {
          companyId: COMPANY_ID,
          lessonId: lesson1.id,
          type: "SELECT",
          question: "What do you check FIRST before starting a mower?",
          explanation:
            "Walk the area and the machine before the blade ever spins: debris in the grass becomes a projectile, and a loose blade or guard can fail at speed.",
          order: 1,
        },
        {
          companyId: COMPANY_ID,
          lessonId: lesson1.id,
          type: "SELECT",
          question: "The discharge chute guard is missing. What do you do?",
          explanation:
            "Never run a mower without its guards — the chute throws rock and metal at over 100 mph. Tag the machine out and report it.",
          order: 2,
        },
        {
          companyId: COMPANY_ID,
          lessonId: lesson2.id,
          type: "SELECT",
          question: "How do you mow a steep slope with a push mower?",
          explanation:
            "Mow ACROSS slopes with a push mower so a slip doesn't put your feet under the deck. (Riding mowers are the opposite: up and down.)",
          order: 1,
        },
        {
          companyId: COMPANY_ID,
          lessonId: lesson2.id,
          type: "SELECT",
          question: "The grass is wet on a slope. What's the right call?",
          explanation:
            "Wet grass kills traction for you and the machine. Skip or reschedule sloped areas until they're dry — a slide into the blade is not recoverable.",
          order: 2,
        },
      ])
      .returning();

    const optionsByQuestion: Array<Array<{ text: string; correct: boolean }>> =
      [
        [
          { text: "Walk the area for rocks, toys, and debris", correct: true },
          { text: "Top off the fuel while the engine is hot", correct: false },
          { text: "Start it and listen for problems", correct: false },
        ],
        [
          { text: "Tag it out and report it — don't mow", correct: true },
          { text: "Mow carefully, aiming away from people", correct: false },
          { text: "Use it only for short passes", correct: false },
        ],
        [
          { text: "Across the slope, side to side", correct: true },
          { text: "Straight up and down", correct: false },
          { text: "Diagonal figure-eights", correct: false },
        ],
        [
          { text: "Skip it until the grass is dry", correct: true },
          { text: "Mow it slowly with new shoes", correct: false },
          { text: "Mow downhill only", correct: false },
        ],
      ];

    for (let i = 0; i < questionRows.length; i++) {
      await tx.insert(schema.questionOptions).values(
        optionsByQuestion[i].map((option) => ({
          companyId: COMPANY_ID,
          questionId: questionRows[i].id,
          text: option.text,
          correct: option.correct,
        }))
      );
    }

    await tx
      .insert(schema.userProgress)
      .values({
        userId: DEV_USER_ID,
        companyId: COMPANY_ID,
        userName: "Dev User",
        userImageSrc: "/mascot.svg",
        activeCourseId: course.id,
      })
      .onConflictDoNothing();

    console.log(
      `Seeded course ${course.id} (v${version.version}): 1 module, 1 unit, 2 lessons, 4 questions.`
    );
  });

  await pool.end();
};

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
