import { cache } from "react";

import { and, asc, eq } from "drizzle-orm";

import { reviewQueue } from "@/db/schema";
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
