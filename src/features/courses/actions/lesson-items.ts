"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { lessonItems, lessons, mediaAssets } from "@/db/schema";
import {
  LESSON_ITEM_KINDS,
  parseLessonItemPayload,
  type LessonItemKind,
} from "@/features/courses/lesson-item-schema";
import { scoped } from "@/shared/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/shared/errors";

import { requireAuthor } from "./content-helpers";

/**
 * Owner authoring for lesson-anatomy teach items (Phase 2). Mirrors the
 * content.ts actions — envelope-wrapped, scoped (RLS), office-role gated.
 * Payloads are validated by the per-kind zod schema before every write
 * (lesson-item-schema.ts), so a stored row is always renderable.
 */

/** A fresh item starts with a minimal valid payload the owner then edits. */
const DEFAULT_PAYLOAD: Record<LessonItemKind, Record<string, unknown>> = {
  teaching: { markdown: "New teaching point — edit this." },
  narrative: { text: "A short real-world story — edit this.", hook: "" },
  voice_note: { mediaId: null, source: "owner", transcript: "" },
  image_pair: { wrongMediaId: null, rightMediaId: null, caption: "" },
};

const createSchema = z.object({
  lessonId: z.number().int().positive(),
  kind: z.enum(LESSON_ITEM_KINDS),
});

/** Append a new (default-payload) teach item to a lesson. */
export const createLessonItem = async (
  input: unknown
): Promise<Result<{ id: number }>> =>
  guard<{ id: number }>(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<{ id: number }>>(auth, async (tx) => {
      const lesson = await tx.query.lessons.findFirst({
        where: eq(lessons.id, parsed.data.lessonId),
        columns: { id: true },
      });
      if (!lesson) return err("not_found", "Lesson not found.");

      // 1-based order at the end of the lesson's item list.
      const nextRow = await tx.execute<{ next: number }>(sql`
        SELECT COALESCE(MAX("order"), 0) + 1 AS next
        FROM lesson_items WHERE lesson_id = ${parsed.data.lessonId}
      `);
      const order = nextRow.rows[0]?.next ?? 1;

      const [row] = await tx
        .insert(lessonItems)
        .values({
          companyId: auth.companyId,
          lessonId: parsed.data.lessonId,
          order,
          kind: parsed.data.kind,
          payload: DEFAULT_PAYLOAD[parsed.data.kind],
        })
        .returning({ id: lessonItems.id });

      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok({ id: row.id });
    });
  });

const updateSchema = z.object({
  itemId: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});

/** Replace an item's payload (validated against its stored kind). */
export const updateLessonItem = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const item = await tx.query.lessonItems.findFirst({
        where: eq(lessonItems.id, parsed.data.itemId),
        columns: { id: true, kind: true },
      });
      if (!item) return err("not_found", "Item not found.");

      const valid = parseLessonItemPayload(item.kind, parsed.data.payload);
      if (!valid.ok) return err("validation", `Invalid content: ${valid.reason}`);

      await tx
        .update(lessonItems)
        .set({ payload: valid.payload, updatedAt: new Date() })
        .where(eq(lessonItems.id, parsed.data.itemId));

      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok(null);
    });
  });

const idSchema = z.object({ itemId: z.number().int().positive() });

export const deleteLessonItem = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      await tx.delete(lessonItems).where(eq(lessonItems.id, parsed.data.itemId));
      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok(null);
    });
  });

const moveSchema = z.object({
  itemId: z.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

/** Reorder an item by swapping `order` with its adjacent sibling. */
export const moveLessonItem = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const item = await tx.query.lessonItems.findFirst({
        where: eq(lessonItems.id, parsed.data.itemId),
        columns: { id: true, lessonId: true, order: true },
      });
      if (!item) return err("not_found", "Item not found.");

      // The neighbour in the move direction: the row with the closest order
      // above (up) or below (down) within the same lesson.
      const neighbour = await tx.query.lessonItems.findFirst({
        where: and(
          eq(lessonItems.lessonId, item.lessonId),
          ne(lessonItems.id, item.id),
          parsed.data.direction === "up"
            ? sql`"order" < ${item.order}`
            : sql`"order" > ${item.order}`
        ),
        orderBy: (i, { asc, desc }) =>
          parsed.data.direction === "up" ? [desc(i.order)] : [asc(i.order)],
        columns: { id: true, order: true },
      });
      if (!neighbour) return ok(null); // already at the edge — no-op

      // Swap via a temporary negative order to dodge the (lesson_id, order)
      // unique index during the exchange.
      await tx
        .update(lessonItems)
        .set({ order: -item.id })
        .where(eq(lessonItems.id, item.id));
      await tx
        .update(lessonItems)
        .set({ order: item.order })
        .where(eq(lessonItems.id, neighbour.id));
      await tx
        .update(lessonItems)
        .set({ order: neighbour.order })
        .where(eq(lessonItems.id, item.id));

      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok(null);
    });
  });

const setMediaSchema = z.object({
  itemId: z.number().int().positive(),
  slot: z.enum(["wrong", "right", "audio"]),
  mediaAssetId: z.string().uuid(),
});

/**
 * Attach an uploaded (or generated) media asset to an item slot:
 *   image_pair → wrong | right ; voice_note → audio.
 * The media must belong to this company (RLS scopes the read). The slot must
 * match the item kind. Owner-attached audio is marked source='owner'.
 */
export const setLessonItemMedia = async (
  input: unknown
): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = setMediaSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();
    const { itemId, slot, mediaAssetId } = parsed.data;

    return scoped<Result<null>>(auth, async (tx) => {
      const item = await tx.query.lessonItems.findFirst({
        where: eq(lessonItems.id, itemId),
      });
      if (!item) return err("not_found", "Item not found.");

      const media = await tx.query.mediaAssets.findFirst({
        where: eq(mediaAssets.id, mediaAssetId),
        columns: { id: true },
      });
      if (!media) return err("not_found", "Media not found.");

      const slotOk =
        (item.kind === "image_pair" && (slot === "wrong" || slot === "right")) ||
        (item.kind === "voice_note" && slot === "audio");
      if (!slotOk) {
        return err("validation", `A ${slot} asset can't attach to a ${item.kind} item.`);
      }

      const base = { ...(item.payload as Record<string, unknown>) };
      if (slot === "wrong") base.wrongMediaId = mediaAssetId;
      else if (slot === "right") base.rightMediaId = mediaAssetId;
      else {
        base.mediaId = mediaAssetId;
        base.source = "owner";
      }

      const valid = parseLessonItemPayload(item.kind, base);
      if (!valid.ok) return err("validation", `Invalid content: ${valid.reason}`);

      await tx
        .update(lessonItems)
        .set({ payload: valid.payload, updatedAt: new Date() })
        .where(eq(lessonItems.id, itemId));

      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok(null);
    });
  });
