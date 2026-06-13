import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { courses } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  countPendingAssets,
  markAssetFailed,
  nextPendingAssetId,
  runCourseAsset,
} from "@/lib/content/course-asset-runner";
import { scoped } from "@/lib/db/scoped";

/**
 * Generate ONE course image (AI Course Builder), synchronously.
 *
 * Free-tier strategy: the client calls this once per image and loops — fire,
 * wait (~100s under Fluid Compute's 300s budget), then the next — so images
 * generate strictly one at a time with NO background worker. Each call returns
 * what it did + how many remain, so the loop is resumable (a refresh or re-click
 * picks up the remaining PENDING) and a single failure never blocks the rest.
 *
 * The work itself is shared with the Inngest pipeline (course-asset-runner).
 */
export const maxDuration = 300;

const bodySchema = z.object({ courseId: z.number().int().positive() });

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json(
      { error: "forbidden", message: "Only owners and managers can generate images." },
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
    return NextResponse.json({ error: "validation", message: "A courseId is required." }, { status: 400 });
  }
  const { courseId } = parsed.data;

  // Pick the next PENDING asset (RLS scopes to this company).
  const assetId = await scoped(auth, async (tx) => {
    const course = await tx.query.courses.findFirst({ where: eq(courses.id, courseId) });
    if (!course) return undefined;
    return nextPendingAssetId(tx, courseId);
  });

  if (assetId === undefined) {
    return NextResponse.json({ error: "not_found", message: "Course not found." }, { status: 404 });
  }
  if (assetId === null) {
    return NextResponse.json({ ok: true, done: true, remaining: 0 });
  }

  // Generate it. On failure, mark FAILED (fresh tx) and keep going — the client
  // loop continues with the remaining queue rather than stalling.
  let generated: { ref: string; kind: string } | null = null;
  let failed: { message: string } | null = null;
  try {
    const outcome = await scoped(auth, (tx) =>
      runCourseAsset(tx, auth.companyId, assetId)
    );
    generated = { ref: outcome.ref, kind: outcome.kind };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    await scoped(auth, (tx) => markAssetFailed(tx, assetId, message)).catch(() => {});
    failed = { message };
  }

  const remaining = await scoped(auth, (tx) => countPendingAssets(tx, courseId));

  return NextResponse.json({ ok: true, done: false, generated, failed, remaining });
}
