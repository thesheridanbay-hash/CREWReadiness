import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { aiJobs, courses, mediaAssets, reviewQueue } from "@/db/schema";
import { analyzePhoto } from "@/lib/ai/gateway";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/shared/db/scoped";

/**
 * Incident → micro-lesson (go-live C), synchronously. The owner uploads a
 * job-site photo + note; the AI photo pipeline (analyzePhoto) drafts a short
 * lesson, which lands in the review queue (D6 — never auto-published). The
 * owner approves it (existing /studio/review) and assigns it (A1).
 *
 * Free-tier strategy mirrors course generation: run inside the route under the
 * 300s Fluid Compute cap, no background worker. The whole thing is one scoped
 * transaction — if the AI call fails, nothing partial persists.
 */
export const maxDuration = 300;

const bodySchema = z.object({
  mediaAssetId: z.string().uuid(),
  note: z.string().max(2000).optional(),
  courseId: z.number().int().positive().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json(
      { error: "forbidden", message: "Only owners and managers can create incidents." },
      { status: 403 }
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = {};
  }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: "An uploaded photo is required." },
      { status: 400 }
    );
  }

  const { mediaAssetId, note, courseId } = parsed.data;

  try {
    const result = await scoped(auth, async (tx) => {
      const media = await tx.query.mediaAssets.findFirst({
        where: eq(mediaAssets.id, mediaAssetId),
      });
      if (!media) return { notFound: true as const };

      // Optional destination course (approval appends to its "AI Imports").
      let destCourseId: number | null = courseId ?? null;
      if (destCourseId) {
        const course = await tx.query.courses.findFirst({
          where: eq(courses.id, destCourseId),
        });
        if (!course) destCourseId = null;
      }

      const [job] = await tx
        .insert(aiJobs)
        .values({
          companyId: auth.companyId,
          kind: "PHOTO_TO_TRAINING",
          mediaAssetId,
          payload: { ownerNote: note ?? "", createdBy: auth.userId },
        })
        .returning();

      // pathname is the Blob URL the provider can fetch (the proxy is authed).
      const analysis = await analyzePhoto(
        { tx, companyId: auth.companyId, jobId: job.id },
        { imageUrl: media.pathname, ownerNote: note ?? "" }
      );

      const [item] = await tx
        .insert(reviewQueue)
        .values({
          companyId: auth.companyId,
          jobId: job.id,
          courseId: destCourseId,
          draft: analysis.draft as unknown as Record<string, unknown>,
        })
        .returning({ id: reviewQueue.id });

      await tx
        .update(aiJobs)
        .set({ status: "SUCCEEDED", updatedAt: new Date() })
        .where(eq(aiJobs.id, job.id));

      return {
        reviewItemId: item.id,
        title: analysis.draft.title,
        observations: analysis.observations.slice(0, 300),
      };
    });

    if ("notFound" in result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Couldn't read that photo.";
    return NextResponse.json(
      { error: "ai_failed", message }, // nothing persisted (tx rolled back)
      { status: 502 }
    );
  }
}
