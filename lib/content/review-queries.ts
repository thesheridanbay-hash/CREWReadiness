import { cache } from "react";

import { and, asc, eq } from "drizzle-orm";

import { reviewQueue } from "@/db/schema";
import { lessonDraftSchema } from "@/lib/ai/types";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/** Review queue (D6): pending AI drafts awaiting owner approval. */

export type ReviewItem = {
  id: number;
  title: string;
  lessonCount: number;
  questionCount: number;
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

    return rows.map((row) => {
      const draft = lessonDraftSchema.safeParse(row.draft);
      if (!draft.success) {
        return { id: row.id, title: "Unrecognized draft", lessonCount: 0, questionCount: 0 };
      }
      return {
        id: row.id,
        title: draft.data.title,
        lessonCount: draft.data.lessons.length,
        questionCount: draft.data.lessons.reduce(
          (sum, lesson) => sum + lesson.questions.length,
          0
        ),
      };
    });
  });
});
