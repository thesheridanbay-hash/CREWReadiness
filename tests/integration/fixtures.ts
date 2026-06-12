import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { neonConfig, Pool } from "@neondatabase/serverless";

import * as schema from "@/db/schema";

/**
 * Integration-test fixtures (T5 — D18).
 *
 * ownerDb: connects with the OWNER/test connection string and seeds one full
 * content tree per company INSIDE a tenant-context transaction (satisfies
 * WITH CHECK whether or not RLS applies to the test role).
 *
 * The seeded ids are returned so isolation tests can probe every tenant
 * table from db/tenant-tables.ts.
 */

neonConfig.webSocketConstructor = globalThis.WebSocket;

export const testDatabaseUrl = () => process.env.DATABASE_URL_TEST ?? "";

export const makeDb = () => {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  return { db: drizzle(pool, { schema }), pool };
};

export type SeededCompany = Awaited<ReturnType<typeof seedCompany>>;

/** Seed one row in every tenant table for the given company. */
export const seedCompany = async (
  db: ReturnType<typeof makeDb>["db"],
  companyId: string
) => {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`
    );

    const userId = `emp_${randomUUID()}`;

    const [course] = await tx
      .insert(schema.courses)
      .values({ companyId, title: `${companyId} course` })
      .returning();

    const [version] = await tx
      .insert(schema.contentVersions)
      .values({ companyId, courseId: course.id, version: 1, publishedBy: "t" })
      .returning();

    const [mod] = await tx
      .insert(schema.modules)
      .values({ companyId, courseId: course.id, title: "m", order: 1 })
      .returning();

    const [unit] = await tx
      .insert(schema.units)
      .values({ companyId, moduleId: mod.id, title: "u", order: 1 })
      .returning();

    const [lesson] = await tx
      .insert(schema.lessons)
      .values({ companyId, unitId: unit.id, title: "l", order: 1 })
      .returning();

    const [question] = await tx
      .insert(schema.questions)
      .values({
        companyId,
        lessonId: lesson.id,
        type: "SELECT",
        question: "q?",
        order: 1,
      })
      .returning();

    await tx.insert(schema.questionOptions).values({
      companyId,
      questionId: question.id,
      text: "a",
      correct: true,
    });

    const [variant] = await tx
      .insert(schema.questionVariants)
      .values({
        companyId,
        questionId: question.id,
        prompt: "v?",
        options: [{ text: "a", correct: true }],
      })
      .returning();

    const [session] = await tx
      .insert(schema.learningSessions)
      .values({
        companyId,
        userId,
        lessonId: lesson.id,
        contentVersionId: version.id,
        activeQuestionId: question.id,
      })
      .returning();

    await tx.insert(schema.attempts).values({
      companyId,
      userId,
      sessionId: session.id,
      questionId: question.id,
      variantId: variant.id,
      correct: true,
    });

    await tx.insert(schema.parkedConcepts).values({
      companyId,
      userId,
      questionId: question.id,
      lessonId: lesson.id,
    });

    const [crew] = await tx
      .insert(schema.crews)
      .values({ companyId, name: "crew" })
      .returning();

    await tx
      .insert(schema.crewMembers)
      .values({ companyId, crewId: crew.id, userId });

    await tx.insert(schema.assignments).values({
      companyId,
      courseId: course.id,
      crewId: crew.id,
      assignedBy: "t",
    });

    const [tag] = await tx
      .insert(schema.tags)
      .values({ companyId, name: `tag-${companyId}` })
      .returning();

    await tx
      .insert(schema.lessonTags)
      .values({ companyId, lessonId: lesson.id, tagId: tag.id });

    const [media] = await tx
      .insert(schema.mediaAssets)
      .values({
        companyId,
        uploadedBy: userId,
        pathname: `p/${companyId}`,
        contentType: "image/jpeg",
        kind: "PHOTO",
      })
      .returning();

    const [job] = await tx
      .insert(schema.aiJobs)
      .values({
        companyId,
        kind: "PHOTO_TO_TRAINING",
        mediaAssetId: media.id,
      })
      .returning();

    await tx.insert(schema.aiUsageEvents).values({
      companyId,
      jobId: job.id,
      operation: "analyzePhoto",
      provider: "test",
    });

    await tx.insert(schema.reviewQueue).values({
      companyId,
      jobId: job.id,
      courseId: course.id,
      draft: { kind: "lesson" },
    });

    await tx.insert(schema.notifications).values({
      companyId,
      userId,
      type: "test",
    });

    await tx.insert(schema.userProgress).values({
      userId,
      companyId,
      activeCourseId: course.id,
    });

    return { companyId, userId, courseId: course.id, jobId: job.id };
  });
};

/** Run fn inside a transaction pinned to the given tenant context. */
export const withTenant = async <T>(
  db: ReturnType<typeof makeDb>["db"],
  companyId: string | null,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> =>
  db.transaction(async (tx) => {
    if (companyId !== null) {
      await tx.execute(
        sql`SELECT set_config('app.company_id', ${companyId}, true)`
      );
    }
    return fn(tx);
  });
