import { describe, expect, it } from "vitest";

import {
  applyTranslation,
  parseLessonItemPayload,
  toLessonItemView,
  translatableFields,
  type LessonItemPayload,
  type LessonItemPayloadMap,
} from "@/features/courses/lesson-item-schema";

const mediaUrl = (id: string | null | undefined) => (id ? `/api/media/${id}` : null);

/**
 * lesson_items.payload is a trust boundary: stored in jsonb, validated per
 * kind, rendered later. parseLessonItemPayload must accept well-formed
 * payloads, reject malformed ones, and skip unknown kinds (the render
 * dispatcher relies on the tagged result to skip-and-log, not crash).
 */

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseLessonItemPayload", () => {
  it("accepts a teaching payload", () => {
    const r = parseLessonItemPayload("teaching", { markdown: "Keep two hands on it." });
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "teaching") expect(r.payload.markdown).toContain("two hands");
  });

  it("rejects empty teaching markdown", () => {
    expect(parseLessonItemPayload("teaching", { markdown: "" }).ok).toBe(false);
  });

  it("accepts an image_pair and defaults caption + media ids", () => {
    const r = parseLessonItemPayload("image_pair", {});
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "image_pair") {
      expect(r.payload.caption).toBe("");
      expect(r.payload.wrongMediaId).toBeNull();
      expect(r.payload.rightMediaId).toBeNull();
    }
  });

  it("accepts image_pair with real media ids", () => {
    const r = parseLessonItemPayload("image_pair", {
      wrongMediaId: UUID,
      rightMediaId: UUID,
      caption: "Left is wrong, right is correct.",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an image_pair with a non-uuid media id", () => {
    expect(
      parseLessonItemPayload("image_pair", { wrongMediaId: "not-a-uuid" }).ok
    ).toBe(false);
  });

  it("accepts a voice_note and defaults transcript", () => {
    const r = parseLessonItemPayload("voice_note", { source: "tts" });
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "voice_note") {
      expect(r.payload.transcript).toBe("");
      expect(r.payload.mediaId).toBeNull();
    }
  });

  it("rejects a voice_note with an invalid source", () => {
    expect(parseLessonItemPayload("voice_note", { source: "robot" }).ok).toBe(false);
  });

  it("accepts a narrative with an optional incidentId", () => {
    const r = parseLessonItemPayload("narrative", {
      text: "A crew member skipped the lockout and...",
      hook: "What would you have done?",
      incidentId: 42,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "narrative") expect(r.payload.incidentId).toBe(42);
  });

  it("rejects a narrative with empty text", () => {
    expect(parseLessonItemPayload("narrative", { text: "" }).ok).toBe(false);
  });

  it("skips an unknown kind with a reason", () => {
    const r = parseLessonItemPayload("video_quiz", { markdown: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("unknown kind");
  });
});

describe("translatableFields", () => {
  it("extracts only the translatable keys per kind", () => {
    expect(translatableFields("teaching", { markdown: "Hi" } as LessonItemPayload)).toEqual({
      markdown: "Hi",
    });
    expect(
      translatableFields("narrative", {
        text: "Story",
        hook: "Hook",
      } as LessonItemPayload)
    ).toEqual({ text: "Story", hook: "Hook" });
    // Media ids are NOT translatable — caption only.
    expect(
      translatableFields("image_pair", {
        wrongMediaId: UUID,
        rightMediaId: UUID,
        caption: "Cap",
      } as LessonItemPayload)
    ).toEqual({ caption: "Cap" });
  });

  it("omits empty strings", () => {
    expect(
      translatableFields("narrative", { text: "Story", hook: "" } as LessonItemPayload)
    ).toEqual({ text: "Story" });
  });
});

describe("applyTranslation", () => {
  const base = {
    text: "English story",
    hook: "English hook",
  } satisfies LessonItemPayloadMap["narrative"];

  it("overlays translated keys", () => {
    const out = applyTranslation("narrative", base, {
      text: "Historia",
      hook: "Gancho",
    });
    expect(out).toMatchObject({ text: "Historia", hook: "Gancho" });
  });

  it("falls back to base for missing or blank translations", () => {
    expect(applyTranslation("narrative", base, { text: "Historia" })).toMatchObject({
      text: "Historia",
      hook: "English hook",
    });
    expect(applyTranslation("narrative", base, { text: "", hook: "" })).toMatchObject({
      text: "English story",
      hook: "English hook",
    });
    expect(applyTranslation("narrative", base, null)).toBe(base);
  });

  it("never overlays media ids", () => {
    const ip = {
      wrongMediaId: UUID,
      rightMediaId: UUID,
      caption: "Cap",
    } satisfies LessonItemPayloadMap["image_pair"];
    const out = applyTranslation("image_pair", ip, { caption: "Subtítulo" });
    expect(out).toMatchObject({
      wrongMediaId: UUID,
      rightMediaId: UUID,
      caption: "Subtítulo",
    });
  });
});

describe("toLessonItemView", () => {
  it("builds a teaching view", () => {
    const r = toLessonItemView(
      { id: 1, kind: "teaching", payload: { markdown: "Hi" } },
      mediaUrl
    );
    expect(r).toEqual({ ok: true, view: { id: 1, kind: "teaching", markdown: "Hi" } });
  });

  it("resolves image_pair media ids to proxy URLs", () => {
    const r = toLessonItemView(
      {
        id: 2,
        kind: "image_pair",
        payload: { wrongMediaId: UUID, rightMediaId: null, caption: "C" },
      },
      mediaUrl
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.view.kind === "image_pair") {
      expect(r.view.wrongSrc).toBe(`/api/media/${UUID}`);
      expect(r.view.rightSrc).toBeNull();
      expect(r.view.caption).toBe("C");
    }
  });

  it("resolves a voice_note audio URL", () => {
    const r = toLessonItemView(
      { id: 3, kind: "voice_note", payload: { mediaId: UUID, source: "owner", transcript: "T" } },
      mediaUrl
    );
    if (r.ok && r.view.kind === "voice_note") {
      expect(r.view.audioSrc).toBe(`/api/media/${UUID}`);
      expect(r.view.transcript).toBe("T");
    }
  });

  it("overlays translated text into the view", () => {
    const r = toLessonItemView(
      { id: 4, kind: "narrative", payload: { text: "EN", hook: "HK" } },
      mediaUrl,
      { text: "ES", hook: "" }
    );
    // text overlaid, blank hook falls back to base.
    if (r.ok && r.view.kind === "narrative") {
      expect(r.view.text).toBe("ES");
      expect(r.view.hook).toBe("HK");
    }
  });

  it("skips an unknown kind", () => {
    const r = toLessonItemView({ id: 5, kind: "mystery", payload: {} }, mediaUrl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("unknown kind");
  });

  it("skips a malformed payload", () => {
    const r = toLessonItemView({ id: 6, kind: "teaching", payload: { markdown: "" } }, mediaUrl);
    expect(r.ok).toBe(false);
  });
});
