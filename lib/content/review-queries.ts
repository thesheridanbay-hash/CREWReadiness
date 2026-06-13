import { cache } from "react";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { aiJobs, reviewQueue } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { classifyDraft, courseDraftCounts } from "@/lib/content/draft-kind";

/** Review queue (D6): pending AI drafts awaiting owner approval. */

export type ReviewItem = {
  id: number;
  title: string;
  lessonCount: number;
  questionCount: number;
  /** "course" = rich AI Course Builder draft; "lesson" = flat pipeline draft. */
  kind: "course" | "lesson" | "unknown";
};

export const getReviewQueue = cache(async (): Promise<ReviewItem[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  return scoped(session, async (tx) => {
    const rows = await tx.query.reviewQueue.findMany({
      where: and(
        eq(reviewQueue.companyId, session.companyId),
        eq(reviewQueue.status, "PENDING")
      ),
      orderBy: [asc(reviewQueue.createdAt)],
    });

    return rows.map((row): ReviewItem => {
      const classified = classifyDraft(row.draft);

      if (classified.kind === "course") {
        const counts = courseDraftCounts(classified.course);
        return {
          id: row.id,
          title: classified.course.courseTitle,
          lessonCount: counts.lessonCount,
          questionCount: counts.questionCount,
          kind: "course",
        };
      }

      if (classified.kind === "lesson") {
        return {
          id: row.id,
          title: classified.lesson.title,
          lessonCount: classified.lesson.lessons.length,
          questionCount: classified.lesson.lessons.reduce(
            (sum, lesson) => sum + lesson.questions.length,
            0
          ),
          kind: "lesson",
        };
      }

      return { id: row.id, title: "Unrecognized draft", lessonCount: 0, questionCount: 0, kind: "unknown" };
    });
  });
});

export type GenerationAttempt = {
  jobId: string;
  status: "RUNNING" | "FAILED" | "DEAD_LETTER";
  error: string | null;
  title: string;
  createdAt: Date;
  /** A RUNNING attempt older than 5 min is almost certainly dead — retryable. */
  stale: boolean;
};

/**
 * Course-generation attempts that did NOT produce a draft (still running or
 * failed). Surfaced on the review page so a timed-out/failed generation is
 * visible with its error and retryable — rather than vanishing (bugfix).
 */
export const getCourseGenerationAttempts = cache(
  async (): Promise<GenerationAttempt[]> => {
    const session = await getSession();
    if (!session || session.role === "employee") return [];

    return scoped(session, async (tx) => {
      const rows = await tx.query.aiJobs.findMany({
        where: and(
          eq(aiJobs.companyId, session.companyId),
          eq(aiJobs.kind, "GENERATE_COURSE"),
          inArray(aiJobs.status, ["RUNNING", "FAILED", "DEAD_LETTER"])
        ),
        orderBy: [desc(aiJobs.createdAt)],
        limit: 10,
      });

      const now = Date.now();
      return rows.map((row): GenerationAttempt => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const pick = (key: string) =>
          typeof payload[key] === "string" ? (payload[key] as string) : "";
        const title =
          pick("title") ||
          pick("userBrief").slice(0, 60) ||
          pick("topics").slice(0, 60) ||
          "Course draft";
        return {
          jobId: row.id,
          status: row.status as GenerationAttempt["status"],
          error: row.error,
          title,
          createdAt: row.createdAt,
          stale:
            row.status === "RUNNING" &&
            now - row.createdAt.getTime() > 5 * 60 * 1000,
        };
      });
    });
  }
);
