import { NextResponse, type NextRequest } from "next/server";

import { reviewQueue } from "@/db/schema";
import { generateCourse } from "@/lib/ai/gateway";
import { getSession } from "@/lib/auth/session";
import { courseBuilderInputSchema } from "@/lib/content/course-builder-schema";
import { scoped } from "@/lib/db/scoped";

/**
 * Synchronous AI course generation (AI Course Builder).
 *
 * Why a route and not the Inngest job: the provider (OpenClaw) takes ~2 minutes
 * per generation, which is far past a normal request but well within Vercel
 * Fluid Compute's 300s function limit (enabled on this project). Running it
 * here means course generation works on the free tier with NO background
 * worker to connect — the owner clicks Generate, waits, and the draft lands in
 * the review queue. (The Inngest generate-course path remains for when a
 * background worker is connected and we want fire-and-forget at scale.)
 *
 * The draft is never auto-published (D6): it goes to the review queue for owner
 * approval, which materializes it into a course.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json(
      { error: "forbidden", message: "Only owners and managers can build courses." },
      { status: 403 }
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = {};
  }

  const parsed = courseBuilderInputSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { userBrief, ...brief } = parsed.data;

  try {
    const result = await scoped(auth, async (tx) => {
      const draft = await generateCourse(
        { tx, companyId: auth.companyId },
        { brief, userBrief: userBrief ?? "" }
      );
      const [row] = await tx
        .insert(reviewQueue)
        .values({
          companyId: auth.companyId,
          courseId: null,
          draft: draft as unknown as Record<string, unknown>,
        })
        .returning();
      return {
        reviewItemId: row.id,
        title: draft.courseTitle,
        modules: draft.modules.length,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Provider/validation failures surface to the wizard so the owner can retry
    // — nothing is left in a silent stuck state.
    const message =
      error instanceof Error ? error.message : "Course generation failed.";
    return NextResponse.json({ error: "generation_failed", message }, { status: 502 });
  }
}
