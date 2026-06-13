import { describe, expect, it } from "vitest";

import {
  courseAssets,
  courses,
  lessons,
  modules,
  questionOptions,
  questions,
  units,
} from "@/db/schema";
import type { ScopedTx } from "@/shared/db/scoped";
import type { CourseDraft } from "@/features/ai/types";
import {
  materializeCourseDraft,
  planCourseMaterialization,
} from "@/lib/content/materialize-course";

/**
 * Materializer: the pure planner (refs, ordering, kind mapping, queue) and the
 * thin insert (FK threading, companyId on every row). The insert is exercised
 * against a fake transaction that records inserts and hands back sequential
 * ids — no database needed.
 */

const lessonA = {
  ref: "whatever",
  title: "Trimmer safety",
  teachingText: "Two hands on the trimmer, always.",
  assets: [
    { ref: "x1", kind: "illustration" as const, prompt: "two hands on a trimmer" },
    { ref: "x2", kind: "realistic" as const, prompt: "photo of correct grip" },
  ],
  questions: [
    {
      question: "Where do your hands go?",
      explanation: "Two hands keeps the head controlled.",
      options: [
        { text: "Two hands", correct: true },
        { text: "One hand", correct: false },
      ],
    },
  ],
};

const lessonB = {
  ref: "whatever2",
  title: "Storage",
  teachingText: "Hang trimmers off the ground.",
  assets: [],
  questions: [
    {
      question: "Where do trimmers go after use?",
      explanation: "Off the ground prevents damage.",
      options: [
        { text: "On the rack", correct: true },
        { text: "In the dirt", correct: false },
      ],
    },
  ],
};

const draft: CourseDraft = {
  courseTitle: "Equipment Basics",
  courseIconPrompt: "a friendly lawnmower mascot",
  modules: [
    {
      ref: "m",
      title: "Hand tools",
      units: [{ ref: "u", title: "Trimmers", lessons: [lessonA, lessonB] }],
    },
  ],
};

describe("planCourseMaterialization", () => {
  it("renumbers lesson assets to stable A-refs in tree order", () => {
    const plan = planCourseMaterialization(draft);
    const assetsA = plan.modules[0].units[0].lessons[0].assets;
    const assetsB = plan.modules[0].units[0].lessons[1].assets;

    expect(assetsA.map((a) => a.ref)).toEqual(["A1", "A2"]);
    expect(assetsA.map((a) => a.kind)).toEqual(["ILLUSTRATION", "REALISTIC"]);
    expect(assetsA.map((a) => a.order)).toEqual([1, 2]);
    expect(assetsB).toEqual([]);
  });

  it("puts the icon at order 0 with ref ICON and counts it in assetCount", () => {
    const plan = planCourseMaterialization(draft);
    expect(plan.icon).toEqual({
      ref: "ICON",
      kind: "ICON",
      prompt: "a friendly lawnmower mascot",
      order: 0,
    });
    expect(plan.assetCount).toBe(5); // icon + 2 images + 2 lesson voiceovers
    const lessonsPlan = plan.modules[0].units[0].lessons;
    expect(lessonsPlan[0].audio).toMatchObject({ ref: "V3", kind: "AUDIO", order: 3 });
    expect(lessonsPlan[1].audio).toMatchObject({ ref: "V4", kind: "AUDIO", order: 4 });
  });

  it("assigns 1-based display order at every level", () => {
    const plan = planCourseMaterialization(draft);
    expect(plan.modules[0].order).toBe(1);
    expect(plan.modules[0].units[0].order).toBe(1);
    expect(plan.modules[0].units[0].lessons.map((l) => l.order)).toEqual([1, 2]);
    expect(plan.modules[0].units[0].lessons[0].questions[0].order).toBe(1);
  });
});

type InsertCall = { table: unknown; rows: Record<string, unknown>[] };

const makeFakeTx = () => {
  const calls: InsertCall[] = [];
  let nextId = 0;
  const tx = {
    insert(table: unknown) {
      return {
        values(input: Record<string, unknown> | Record<string, unknown>[]) {
          const rows = Array.isArray(input) ? input : [input];
          calls.push({ table, rows });
          return {
            // Attach the assigned id back onto the row (as the real driver
            // returns the full row), so FK threading is observable in `calls`.
            returning: async () =>
              rows.map((r) => {
                (r as Record<string, unknown>).id = ++nextId;
                return r;
              }),
            then: (resolve: (v: unknown) => unknown) => resolve(rows.length),
          };
        },
      };
    },
  };
  return { tx: tx as unknown as ScopedTx, calls };
};

const rowsFor = (calls: InsertCall[], table: unknown) =>
  calls.filter((c) => c.table === table).flatMap((c) => c.rows);

describe("materializeCourseDraft", () => {
  it("inserts the full tree and returns accurate counts", async () => {
    const { tx, calls } = makeFakeTx();
    const result = await materializeCourseDraft(tx, "co_test", draft);

    expect(result).toEqual({
      courseId: 1,
      moduleCount: 1,
      unitCount: 1,
      lessonCount: 2,
      questionCount: 2,
      assetCount: 5,
    });
    expect(rowsFor(calls, courses)).toHaveLength(1);
    expect(rowsFor(calls, modules)).toHaveLength(1);
    expect(rowsFor(calls, units)).toHaveLength(1);
    expect(rowsFor(calls, lessons)).toHaveLength(2);
    expect(rowsFor(calls, questions)).toHaveLength(2);
    expect(rowsFor(calls, questionOptions)).toHaveLength(4);
  });

  it("stamps companyId on EVERY inserted row (RLS WITH CHECK)", async () => {
    const { tx, calls } = makeFakeTx();
    await materializeCourseDraft(tx, "co_test", draft);
    for (const call of calls) {
      for (const row of call.rows) {
        expect(row.companyId).toBe("co_test");
      }
    }
  });

  it("threads real parent ids from .returning() down the tree", async () => {
    const { tx, calls } = makeFakeTx();
    await materializeCourseDraft(tx, "co_test", draft);
    const courseId = rowsFor(calls, courses)[0].id; // 1
    expect(rowsFor(calls, modules)[0].courseId).toBe(courseId);
    // lessons reference their unit; questions reference their lesson.
    const unitId = rowsFor(calls, units)[0].id;
    expect(rowsFor(calls, lessons)[0].unitId).toBe(unitId);
    expect(rowsFor(calls, lessons)[0].teachingText).toBe(
      "Two hands on the trimmer, always."
    );
  });

  it("leads the asset queue with the course ICON, then lesson art", async () => {
    const { tx, calls } = makeFakeTx();
    await materializeCourseDraft(tx, "co_test", draft);

    const assetCalls = calls.filter((c) => c.table === courseAssets);
    // First course_assets insert is the icon (order 0, no lesson).
    const firstAsset = assetCalls[0].rows[0];
    expect(firstAsset.kind).toBe("ICON");
    expect(firstAsset.order).toBe(0);
    expect(firstAsset.lessonId).toBeNull();

    const allAssets = rowsFor(calls, courseAssets);
    expect(allAssets).toHaveLength(5); // icon + 2 images + 2 voiceovers
    const lessonArt = allAssets.filter((a) => a.kind !== "ICON");
    expect(lessonArt.map((a) => a.ref)).toEqual(["A1", "A2", "V3", "V4"]);
    // Lesson art + voiceovers carry a lessonId (attach to a lesson); icon does not.
    for (const art of lessonArt) {
      expect(art.lessonId).not.toBeNull();
    }
    // Voiceovers are AUDIO assets.
    expect(allAssets.filter((a) => a.kind === "AUDIO").map((a) => a.ref)).toEqual([
      "V3",
      "V4",
    ]);
  });
});
