import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  courseAssets,
  courses,
  lessonTranslations,
  lessons,
  mediaAssets,
  modules,
  questionOptions,
  questions,
  units,
} from "@/db/schema";
import { materializeSnapshot } from "@/lib/marketplace/materialize-snapshot";
import { serializeCourse } from "@/lib/marketplace/serialize-course";
import { courseSnapshotSchema } from "@/lib/marketplace/snapshot";

import { makeDb, testDatabaseUrl, withTenant } from "./fixtures";

/**
 * Adopt engine (course marketplace, PR-2): materializing a snapshot must create
 * a draft course in the ADOPTER's company with shared assets referenced (not
 * copied), ungenerated assets PENDING, and translations re-created. Runs under
 * tenant RLS on the CI Neon branch.
 */

const enabled = Boolean(testDatabaseUrl());

describe.skipIf(!enabled)("materializeSnapshot", () => {
  const company = `adopt-${randomUUID().slice(0, 8)}`;
  let ctx: ReturnType<typeof makeDb>;
  let sharedMediaId: string;

  beforeAll(async () => {
    ctx = makeDb();
    sharedMediaId = await withTenant(ctx.db, company, async (tx) => {
      const [media] = await tx
        .insert(mediaAssets)
        .values({
          companyId: company,
          uploadedBy: "t",
          pathname: `p/${company}`,
          contentType: "image/png",
          kind: "PHOTO",
          public: true,
        })
        .returning();
      return media.id;
    });
  });

  afterAll(async () => {
    await ctx?.pool.end();
  });

  it("creates a draft course: shared icon, pending art, translations", async () => {
    const snapshot = courseSnapshotSchema.parse({
      version: 1,
      courseTitle: "Adopted course",
      category: "safety",
      description: "",
      primaryLanguage: "en",
      icon: { prompt: "icon", mediaAssetId: sharedMediaId },
      modules: [
        {
          title: "M",
          units: [
            {
              title: "U",
              lessons: [
                {
                  title: "L",
                  teachingText: "base",
                  translations: [
                    { lang: "es", title: "L-es", teachingText: "base-es" },
                  ],
                  assets: [
                    {
                      ref: "A1",
                      kind: "ILLUSTRATION",
                      prompt: "art",
                      mediaAssetId: null,
                    },
                  ],
                  questions: [
                    {
                      question: "Q?",
                      explanation: "why",
                      options: [
                        {
                          text: "a",
                          correct: true,
                          translations: [{ lang: "es", text: "a-es" }],
                        },
                        { text: "b", correct: false },
                      ],
                      translations: [
                        { lang: "es", question: "Q-es", explanation: "why-es" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await withTenant(ctx.db, company, (tx) =>
      materializeSnapshot(tx, company, snapshot)
    );

    expect(result.lessonCount).toBe(1);
    expect(result.questionCount).toBe(1);
    expect(result.sharedAssetCount).toBe(1); // icon references the shared blob
    expect(result.pendingAssetCount).toBe(1); // lesson art is regenerated

    const [course] = await withTenant(ctx.db, company, (tx) =>
      tx.select().from(courses).where(eq(courses.id, result.courseId))
    );
    expect(course.companyId).toBe(company);
    expect(course.imageSrc).toContain(sharedMediaId);

    const assets = await withTenant(ctx.db, company, (tx) =>
      tx
        .select()
        .from(courseAssets)
        .where(eq(courseAssets.courseId, result.courseId))
    );
    const icon = assets.find((a) => a.kind === "ICON");
    expect(icon?.status).toBe("GENERATED");
    expect(icon?.mediaAssetId).toBe(sharedMediaId); // shared, not copied
    const art = assets.find((a) => a.kind === "ILLUSTRATION");
    expect(art?.status).toBe("PENDING");
    expect(art?.mediaAssetId).toBeNull();

    const translations = await withTenant(ctx.db, company, (tx) =>
      tx.select().from(lessonTranslations)
    );
    expect(translations.some((t) => t.lang === "es")).toBe(true);
  });
});

describe.skipIf(!enabled)("serializeCourse → materializeSnapshot round-trip", () => {
  const publisher = `pub-${randomUUID().slice(0, 8)}`;
  const adopter = `adp-${randomUUID().slice(0, 8)}`;
  let ctx: ReturnType<typeof makeDb>;
  let courseId: number;

  beforeAll(async () => {
    ctx = makeDb();
    // A minimal but VALID course (a question needs 2+ options for the snapshot).
    courseId = await withTenant(ctx.db, publisher, async (tx) => {
      const [course] = await tx
        .insert(courses)
        .values({ companyId: publisher, title: "Round trip" })
        .returning();
      const [mod] = await tx
        .insert(modules)
        .values({ companyId: publisher, courseId: course.id, title: "M", order: 1 })
        .returning();
      const [unit] = await tx
        .insert(units)
        .values({ companyId: publisher, moduleId: mod.id, title: "U", order: 1 })
        .returning();
      const [lesson] = await tx
        .insert(lessons)
        .values({
          companyId: publisher,
          unitId: unit.id,
          title: "L",
          teachingText: "teach",
          order: 1,
        })
        .returning();
      const [question] = await tx
        .insert(questions)
        .values({
          companyId: publisher,
          lessonId: lesson.id,
          type: "SELECT",
          question: "Q?",
          explanation: "why",
          order: 1,
        })
        .returning();
      await tx.insert(questionOptions).values([
        { companyId: publisher, questionId: question.id, text: "a", correct: true },
        { companyId: publisher, questionId: question.id, text: "b", correct: false },
      ]);
      return course.id;
    });
  });

  afterAll(async () => {
    await ctx?.pool.end();
  });

  it("serializes a valid course and materializes it elsewhere with matching shape", async () => {
    const snapshot = await withTenant(ctx.db, publisher, (tx) =>
      serializeCourse(tx, courseId, { category: "safety", description: "d" })
    );

    expect(snapshot.courseTitle).toBe("Round trip");
    expect(snapshot.modules[0].units[0].lessons[0].questions[0].options).toHaveLength(2);

    const result = await withTenant(ctx.db, adopter, (tx) =>
      materializeSnapshot(tx, adopter, snapshot)
    );
    expect(result.lessonCount).toBe(1);
    expect(result.questionCount).toBe(1);

    const [adopted] = await withTenant(ctx.db, adopter, (tx) =>
      tx.select().from(courses).where(eq(courses.id, result.courseId))
    );
    expect(adopted.companyId).toBe(adopter);
    expect(adopted.title).toBe("Round trip");
  });
});
