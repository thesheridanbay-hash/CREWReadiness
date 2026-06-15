import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { lessonItems, mediaAssets } from "@/db/schema";
import { generateImage, generateSpeech } from "@/features/ai/gateway";
import type { ScopedTx } from "@/shared/db/scoped";

import { toBytes } from "./course-asset-runner";
import { parseLessonItemPayload } from "./lesson-item-schema";

/**
 * On-demand AI generation for ONE lesson-item media slot (Phase 2). Mirrors
 * course-asset-runner but writes the resulting media id back into the item's
 * jsonb payload rather than a course_assets row. Runs synchronously from a
 * route (same free-tier, one-at-a-time strategy as course image generation) —
 * it does NOT need the durable Inngest pipeline for a single slot.
 *
 *   image_pair → wrong | right (uses wrongPrompt/rightPrompt; realistic style)
 *   voice_note → audio        (TTS of the transcript; premium-enforced)
 */

export type LessonItemMediaSlot = "wrong" | "right" | "audio";

/** A user-actionable precondition failure (missing prompt/transcript, wrong
 * slot, not found) — the route maps this to 4xx, vs a provider/generation
 * failure which is 5xx. */
export class LessonItemMediaInputError extends Error {}

/** Cap TTS input so a long transcript can't make a runaway clip (matches builder). */
const TTS_MAX_CHARS = 2000;

export const generateLessonItemMedia = async (
  tx: ScopedTx,
  companyId: string,
  itemId: number,
  slot: LessonItemMediaSlot
): Promise<{ mediaAssetId: string }> => {
  const item = await tx.query.lessonItems.findFirst({
    where: eq(lessonItems.id, itemId),
  });
  if (!item) throw new LessonItemMediaInputError("Item not found.");

  const payload = item.payload as Record<string, unknown>;
  const str = (key: string): string =>
    typeof payload[key] === "string" ? (payload[key] as string).trim() : "";

  let bytesResult;
  let ext: string;
  let mediaKind: "PHOTO" | "VOICE";

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
    bytesResult = await generateSpeech(
      { tx, companyId },
      { text: text.slice(0, TTS_MAX_CHARS) }
    );
    ext = "mp3";
    mediaKind = "VOICE";
  } else {
    if (item.kind !== "image_pair") {
      throw new LessonItemMediaInputError("Images only apply to an image pair.");
    }
    const prompt = str(slot === "wrong" ? "wrongPrompt" : "rightPrompt");
    if (!prompt) {
      throw new LessonItemMediaInputError(
        `Add a "${slot}" prompt before generating that image.`
      );
    }
    bytesResult = await generateImage({ tx, companyId }, { prompt, kind: "realistic" });
    ext = "png";
    mediaKind = "PHOTO";
  }

  const { bytes, contentType } = await toBytes(bytesResult);

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
      kind: mediaKind,
      sizeBytes: bytes.byteLength,
    })
    .returning();

  const next = { ...payload };
  if (slot === "wrong") next.wrongMediaId = media.id;
  else if (slot === "right") next.rightMediaId = media.id;
  else {
    next.mediaId = media.id;
    next.source = "tts";
  }

  const valid = parseLessonItemPayload(item.kind, next);
  if (!valid.ok) throw new Error(`Generated payload invalid: ${valid.reason}`);

  await tx
    .update(lessonItems)
    .set({ payload: valid.payload, updatedAt: new Date() })
    .where(eq(lessonItems.id, itemId));

  return { mediaAssetId: media.id };
};
