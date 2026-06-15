import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSession } from "@/features/auth/session";
import {
  generateLessonItemMedia,
  LessonItemMediaInputError,
} from "@/features/courses/lesson-item-media-runner";
import { scoped } from "@/shared/db/scoped";

/**
 * Generate ONE lesson-item media slot (Phase 2 lesson-anatomy), synchronously.
 * Same free-tier, client-driven strategy as /api/course/generate-image: fire,
 * wait under the Fluid Compute budget, write the media id into the item
 * payload. A single slot at a time — no background worker required.
 */
export const maxDuration = 300;

const bodySchema = z.object({
  itemId: z.number().int().positive(),
  slot: z.enum(["wrong", "right", "audio", "pair"]),
  /** Latest text the owner typed — persisted before generating so no separate
   * (revalidating) save round-trip is needed. Bounds mirror the payload schema. */
  prompts: z
    .object({
      wrongPrompt: z.string().max(500).optional(),
      rightPrompt: z.string().max(500).optional(),
      transcript: z.string().max(4000).optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json(
      { error: "forbidden", message: "Only owners and managers can generate media." },
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
      { error: "validation", message: "An itemId and slot are required." },
      { status: 400 }
    );
  }

  try {
    const { mediaAssetIds } = await scoped(auth, (tx) =>
      generateLessonItemMedia(
        tx,
        auth.companyId,
        parsed.data.itemId,
        parsed.data.slot,
        parsed.data.prompts
      )
    );
    return NextResponse.json({ ok: true, mediaAssetIds });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Media generation failed.";
    // Missing prompt/transcript, wrong slot, not found → the owner can fix it
    // (4xx); a provider/generation failure is upstream (502).
    const status = error instanceof LessonItemMediaInputError ? 400 : 502;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
