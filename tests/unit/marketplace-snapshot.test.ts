import { describe, expect, it } from "vitest";

import {
  categoryLabel,
  isMarketplaceCategory,
} from "@/lib/marketplace/categories";
import {
  courseSnapshotSchema,
  snapshotMediaIds,
  snapshotStats,
  type CourseSnapshot,
} from "@/lib/marketplace/snapshot";

/**
 * The snapshot is the marketplace's cross-tenant contract — validated at both
 * publish (output) and adopt (input). These pin the shape + the media-id
 * collection used to flag/verify shared blobs.
 */

const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";

const snapshot = (over: Record<string, unknown> = {}): unknown => ({
  version: 1,
  courseTitle: "Trimmer Safety",
  category: "safety",
  description: "Stay safe with string trimmers.",
  primaryLanguage: "en",
  icon: { prompt: "a friendly trimmer", mediaAssetId: MEDIA_A },
  modules: [
    {
      title: "Basics",
      units: [
        {
          title: "Handling",
          lessons: [
            {
              title: "Two hands",
              teachingText: "Keep two hands on the trimmer.",
              translations: [
                { lang: "es", title: "Dos manos", teachingText: "Usa dos manos." },
              ],
              assets: [
                {
                  ref: "A1",
                  kind: "ILLUSTRATION",
                  prompt: "two hands on a trimmer",
                  mediaAssetId: MEDIA_B,
                },
              ],
              questions: [
                {
                  question: "Where do your hands go?",
                  explanation: "Two hands keeps control.",
                  options: [
                    { text: "Two hands", correct: true },
                    { text: "One hand", correct: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  ...over,
});

describe("courseSnapshotSchema", () => {
  it("parses a complete snapshot and applies defaults", () => {
    const parsed = courseSnapshotSchema.safeParse(snapshot());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Option translations default to [].
    expect(parsed.data.modules[0].units[0].lessons[0].questions[0].options[0].translations).toEqual([]);
  });

  it("rejects an unknown version", () => {
    expect(courseSnapshotSchema.safeParse(snapshot({ version: 2 })).success).toBe(
      false
    );
  });

  it("rejects a question with no options", () => {
    const bad = snapshot();
    // @ts-expect-error reaching into the loose fixture
    bad.modules[0].units[0].lessons[0].questions[0].options = [];
    expect(courseSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  it("requires at least one module", () => {
    expect(courseSnapshotSchema.safeParse(snapshot({ modules: [] })).success).toBe(
      false
    );
  });
});

describe("snapshotMediaIds", () => {
  it("collects icon + asset media ids (the shared blobs)", () => {
    const parsed = courseSnapshotSchema.parse(snapshot()) as CourseSnapshot;
    expect(snapshotMediaIds(parsed).sort()).toEqual([MEDIA_A, MEDIA_B].sort());
  });

  it("skips PENDING assets (null mediaAssetId)", () => {
    const parsed = courseSnapshotSchema.parse(
      snapshot({ icon: { prompt: "x", mediaAssetId: null } })
    ) as CourseSnapshot;
    // Only the asset blob remains; the icon is ungenerated.
    expect(snapshotMediaIds(parsed)).toEqual([MEDIA_B]);
  });
});

describe("snapshotStats", () => {
  it("counts structure, shared vs pending assets, and languages", () => {
    const parsed = courseSnapshotSchema.parse(snapshot()) as CourseSnapshot;
    const stats = snapshotStats(parsed);
    expect(stats.modules).toBe(1);
    expect(stats.units).toBe(1);
    expect(stats.lessons).toBe(1);
    expect(stats.questions).toBe(1);
    // icon (MEDIA_A) + lesson asset (MEDIA_B) are both generated → shared.
    expect(stats.sharedAssets).toBe(2);
    expect(stats.pendingAssets).toBe(0);
    // primary en + an es lesson translation.
    expect(stats.languages.sort()).toEqual(["en", "es"]);
  });

  it("counts an ungenerated icon as pending", () => {
    const parsed = courseSnapshotSchema.parse(
      snapshot({ icon: { prompt: "x", mediaAssetId: null } })
    ) as CourseSnapshot;
    const stats = snapshotStats(parsed);
    expect(stats.sharedAssets).toBe(1); // lesson asset
    expect(stats.pendingAssets).toBe(1); // icon
  });
});

describe("marketplace categories", () => {
  it("recognizes configured slugs and labels them", () => {
    expect(isMarketplaceCategory("safety")).toBe(true);
    expect(isMarketplaceCategory("nope")).toBe(false);
    expect(categoryLabel("customer-service")).toBe("Customer Service");
    expect(categoryLabel("unknown")).toBe("unknown");
  });
});
