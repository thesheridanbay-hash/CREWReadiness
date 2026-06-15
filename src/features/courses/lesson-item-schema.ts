import { z } from "zod";

/**
 * Lesson-anatomy teach items (Phase 2). The DB stores a `kind` column + a
 * `payload` jsonb; this module is the trust boundary that validates the
 * payload per kind (mirrors courseDraftSchema — payloads are stored in jsonb
 * and rendered later, so every string is length-bounded).
 *
 * The base row holds PRIMARY-language text + media FKs only; other languages
 * overlay via lesson_item_translations (translatableFields / applyTranslation
 * below define exactly which keys are translatable). Media is shared across
 * languages and never appears in a translation row.
 */

export const LESSON_ITEM_KINDS = [
  "teaching",
  "image_pair",
  "voice_note",
  "narrative",
] as const;

export type LessonItemKind = (typeof LESSON_ITEM_KINDS)[number];

/* ── Per-kind payload content (the shape stored in lesson_items.payload) ── */

export const teachingPayloadSchema = z.object({
  markdown: z.string().min(1).max(4000),
});

export const imagePairPayloadSchema = z.object({
  /** media_assets ids; null until uploaded or AI-generated. */
  wrongMediaId: z.string().uuid().nullable().default(null),
  rightMediaId: z.string().uuid().nullable().default(null),
  caption: z.string().max(500).default(""),
  /** Owner-editable AI prompts (kept so the pair can be regenerated). Not
   * shown to learners and not translated. */
  wrongPrompt: z.string().max(500).optional(),
  rightPrompt: z.string().max(500).optional(),
});

export const voiceNotePayloadSchema = z.object({
  /** media_assets id of the audio; null when not yet recorded/generated. */
  mediaId: z.string().uuid().nullable().default(null),
  /** Provenance: owner upload vs AI-TTS fallback. */
  source: z.enum(["owner", "tts"]),
  transcript: z.string().max(4000).default(""),
});

export const narrativePayloadSchema = z.object({
  text: z.string().min(1).max(4000),
  hook: z.string().max(500).default(""),
  /** Optional link back to the Incidents review item this story came from. */
  incidentId: z.number().int().positive().optional(),
});

const PAYLOAD_SCHEMAS = {
  teaching: teachingPayloadSchema,
  image_pair: imagePairPayloadSchema,
  voice_note: voiceNotePayloadSchema,
  narrative: narrativePayloadSchema,
} satisfies Record<LessonItemKind, z.ZodTypeAny>;

export type LessonItemPayloadMap = {
  teaching: z.infer<typeof teachingPayloadSchema>;
  image_pair: z.infer<typeof imagePairPayloadSchema>;
  voice_note: z.infer<typeof voiceNotePayloadSchema>;
  narrative: z.infer<typeof narrativePayloadSchema>;
};

export type LessonItemPayload = LessonItemPayloadMap[LessonItemKind];

export type ParsedLessonItem =
  | { ok: true; kind: "teaching"; payload: LessonItemPayloadMap["teaching"] }
  | { ok: true; kind: "image_pair"; payload: LessonItemPayloadMap["image_pair"] }
  | { ok: true; kind: "voice_note"; payload: LessonItemPayloadMap["voice_note"] }
  | { ok: true; kind: "narrative"; payload: LessonItemPayloadMap["narrative"] }
  | { ok: false; reason: string };

export const isLessonItemKind = (kind: string): kind is LessonItemKind =>
  (LESSON_ITEM_KINDS as readonly string[]).includes(kind);

/**
 * Validate a stored row's (kind, payload). Returns a tagged result instead of
 * throwing so the render dispatcher can skip-and-log a bad row rather than
 * crash the whole lesson (eng-review critical failure-mode T5).
 */
export const parseLessonItemPayload = (
  kind: string,
  raw: unknown
): ParsedLessonItem => {
  if (!isLessonItemKind(kind)) return { ok: false, reason: `unknown kind: ${kind}` };
  const parsed = PAYLOAD_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid payload" };
  }
  // kind ↔ payload alignment is guaranteed by selecting the schema BY kind;
  // the discriminated return type can't prove it, so assert at this boundary.
  return { ok: true, kind, payload: parsed.data } as ParsedLessonItem;
};

/* ── Translation: which payload keys carry translatable text ── */

const TRANSLATABLE_KEYS: Record<LessonItemKind, readonly string[]> = {
  teaching: ["markdown"],
  image_pair: ["caption"],
  voice_note: ["transcript"],
  narrative: ["text", "hook"],
};

/** Extract the translatable text keys of a payload (for the translate backend). */
export const translatableFields = (
  kind: LessonItemKind,
  payload: LessonItemPayload
): Record<string, string> => {
  const out: Record<string, string> = {};
  const source = payload as Record<string, unknown>;
  for (const key of TRANSLATABLE_KEYS[kind]) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
};

/**
 * Overlay translated text onto a base payload: only known translatable keys,
 * only non-empty translated strings (so a missing/blank translation falls back
 * to the base — a learner never sees a blank).
 */
export const applyTranslation = <K extends LessonItemKind>(
  kind: K,
  payload: LessonItemPayloadMap[K],
  fields: Record<string, string> | null | undefined
): LessonItemPayloadMap[K] => {
  if (!fields) return payload;
  const next = { ...(payload as Record<string, unknown>) };
  for (const key of TRANSLATABLE_KEYS[kind]) {
    const value = fields[key];
    if (typeof value === "string" && value.length > 0) next[key] = value;
  }
  return next as LessonItemPayloadMap[K];
};

/* ── Client view (media FKs resolved to /api/media URLs by the query) ── */

export type LessonItemView =
  | { id: number; kind: "teaching"; markdown: string }
  | {
      id: number;
      kind: "image_pair";
      wrongSrc: string | null;
      rightSrc: string | null;
      caption: string;
    }
  | { id: number; kind: "voice_note"; audioSrc: string | null; transcript: string }
  | { id: number; kind: "narrative"; text: string; hook: string };

export type LessonItemViewResult =
  | { ok: true; view: LessonItemView }
  | { ok: false; reason: string };

export type RawLessonItemRow = {
  id: number;
  kind: string;
  payload: unknown;
};

/**
 * Pure row → client-view transform: validate the payload, overlay the
 * learner's translated text, resolve media FKs to proxy URLs. A bad/unknown
 * row returns `{ ok: false, reason }` so the caller can skip-and-log instead
 * of crashing the lesson. Kept DB-free so it's unit-testable in isolation.
 */
export const toLessonItemView = (
  row: RawLessonItemRow,
  mediaUrl: (id: string | null | undefined) => string | null,
  overlayFields?: Record<string, string> | null
): LessonItemViewResult => {
  const parsed = parseLessonItemPayload(row.kind, row.payload);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  switch (parsed.kind) {
    case "teaching": {
      const p = applyTranslation("teaching", parsed.payload, overlayFields);
      return { ok: true, view: { id: row.id, kind: "teaching", markdown: p.markdown } };
    }
    case "image_pair": {
      const p = applyTranslation("image_pair", parsed.payload, overlayFields);
      return {
        ok: true,
        view: {
          id: row.id,
          kind: "image_pair",
          wrongSrc: mediaUrl(p.wrongMediaId),
          rightSrc: mediaUrl(p.rightMediaId),
          caption: p.caption,
        },
      };
    }
    case "voice_note": {
      const p = applyTranslation("voice_note", parsed.payload, overlayFields);
      return {
        ok: true,
        view: {
          id: row.id,
          kind: "voice_note",
          audioSrc: mediaUrl(p.mediaId),
          transcript: p.transcript,
        },
      };
    }
    case "narrative": {
      const p = applyTranslation("narrative", parsed.payload, overlayFields);
      return {
        ok: true,
        view: { id: row.id, kind: "narrative", text: p.text, hook: p.hook },
      };
    }
  }
};
