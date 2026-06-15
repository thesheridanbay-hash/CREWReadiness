import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { lessonItems, mediaAssets } from "@/db/schema";
import { generateImage, generateSpeech } from "@/features/ai/gateway";
import type { ScopedTx } from "@/shared/db/scoped";

import { toBytes } from "./course-asset-runner";
import { parseLessonItemPayload } from "./lesson-item-schema";

/**
 * On-demand AI generation for lesson-item media (Phase 2). Mirrors
 * course-asset-runner but writes the resulting media id(s) back into the
 * item's jsonb payload rather than a course_assets row. Runs synchronously
 * from a route (same free-tier, one-at-a-time strategy as course images) — no
 * durable Inngest pipeline needed for a handful of slots.
 *
 *   image_pair → "pair"  generates BOTH images as a coherent set: the DO first,
 *                        then the DON'T anchored to the same scene/framing so
 *                        the "spot the difference" pair actually matches.
 *                        ("wrong"/"right" still generate a single side.)
 *   voice_note → "audio" TTS of the transcript (premium-enforced).
 *
 * Optional `inputs` persist the latest prompt/transcript text into the payload
 * BEFORE generating, so the caller can pass what the owner just typed without a
 * second round-trip + cache revalidation (which caused a jarring re-render).
 */

export type LessonItemMediaSlot = "wrong" | "right" | "audio" | "pair";

export type LessonItemMediaInputs = {
  wrongPrompt?: string;
  rightPrompt?: string;
  transcript?: string;
};

/** A user-actionable precondition failure (missing prompt/transcript, wrong
 * slot, not found) — the route maps this to 4xx, vs a provider/generation
 * failure which is 5xx. */
export class LessonItemMediaInputError extends Error {}

/** Cap TTS input so a long transcript can't make a runaway clip (matches builder). */
const TTS_MAX_CHARS = 2000;

/** Appended to the DON'T prompt so it shares the scene with the DO image. */
const PAIR_ANCHOR =
  " Keep the same setting, camera framing, lighting, and worker as the matching correct-way photo; only the unsafe action differs.";

export const generateLessonItemMedia = async (
  tx: ScopedTx,
  companyId: string,
  itemId: number,
  slot: LessonItemMediaSlot,
  inputs?: LessonItemMediaInputs
): Promise<{ mediaAssetIds: string[] }> => {
  const item = await tx.query.lessonItems.findFirst({
    where: eq(lessonItems.id, itemId),
  });
  if (!item) throw new LessonItemMediaInputError("Item not found.");

  // Working payload = stored payload + the prompts/transcript the owner just
  // typed (if passed). Persisted once, at the end, with the new media ids.
  const work: Record<string, unknown> = { ...(item.payload as Record<string, unknown>) };
  if (inputs?.wrongPrompt !== undefined) work.wrongPrompt = inputs.wrongPrompt;
  if (inputs?.rightPrompt !== undefined) work.rightPrompt = inputs.rightPrompt;
  if (inputs?.transcript !== undefined) work.transcript = inputs.transcript;

  const str = (key: string): string =>
    typeof work[key] === "string" ? (work[key] as string).trim() : "";

  const storeImage = async (prompt: string): Promise<string> => {
    const result = await generateImage({ tx, companyId }, { prompt, kind: "realistic" });
    return storeBlob(tx, companyId, result, "png", "PHOTO");
  };

  const mediaAssetIds: string[] = [];

  if (slot === "audio") {
    if (item.kind !== "voice_note") {
      throw new LessonItemMediaInputError("Audio only applies to a voice note.");
    }
    const text = str("transcript");
    if (!text) {
      throw new LessonItemMediaInputError(
        "Add a transcript before generating the voiceover."
      );
    }
    const result = await generateSpeech(
      { tx, companyId },
      { text: text.slice(0, TTS_MAX_CHARS) }
    );
    const id = await storeBlob(tx, companyId, result, "mp3", "VOICE");
    work.mediaId = id;
    work.source = "tts";
    mediaAssetIds.push(id);
  } else {
    if (item.kind !== "image_pair") {
      throw new LessonItemMediaInputError("Images only apply to an image pair.");
    }

    if (slot === "pair") {
      const rightPrompt = str("rightPrompt");
      const wrongPrompt = str("wrongPrompt");
      if (!rightPrompt || !wrongPrompt) {
        throw new LessonItemMediaInputError(
          "Add both a DO and a DON'T prompt before generating the pair."
        );
      }
      // DO first, then DON'T anchored to the same scene → a coherent pair.
      work.rightMediaId = await storeImage(rightPrompt);
      work.wrongMediaId = await storeImage(wrongPrompt + PAIR_ANCHOR);
      mediaAssetIds.push(work.rightMediaId as string, work.wrongMediaId as string);
    } else {
      const prompt = str(slot === "wrong" ? "wrongPrompt" : "rightPrompt");
      if (!prompt) {
        throw new LessonItemMediaInputError(
          `Add a "${slot}" prompt before generating that image.`
        );
      }
      const id = await storeImage(slot === "wrong" ? prompt + PAIR_ANCHOR : prompt);
      if (slot === "wrong") work.wrongMediaId = id;
      else work.rightMediaId = id;
      mediaAssetIds.push(id);
    }
  }

  const valid = parseLessonItemPayload(item.kind, work);
  if (!valid.ok) throw new Error(`Generated payload invalid: ${valid.reason}`);

  await tx
    .update(lessonItems)
    .set({ payload: valid.payload, updatedAt: new Date() })
    .where(eq(lessonItems.id, itemId));

  return { mediaAssetIds };
};

/** Persist generated bytes to Blob + a media_assets row; returns the id. */
const storeBlob = async (
  tx: ScopedTx,
  companyId: string,
  result: Awaited<ReturnType<typeof generateImage>>,
  ext: "png" | "mp3",
  kind: "PHOTO" | "VOICE"
): Promise<string> => {
  const { bytes, contentType } = await toBytes(result);
  const blob = await put(`lesson-items/${companyId}/${randomUUID()}.${ext}`, bytes, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  const [media] = await tx
    .insert(mediaAssets)
    .values({
      companyId,
      uploadedBy: "ai",
      pathname: blob.url,
      contentType,
      kind,
      sizeBytes: bytes.byteLength,
    })
    .returning();
  return media.id;
};
