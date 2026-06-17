"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { archiveCourse, publishCourse } from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";
import type { CourseAssetStatus } from "@/features/courses/actions/course-assets";
import type { CourseTranslationStatus } from "@/features/courses/actions/course-translate";
import type { CourseListingInfo } from "@/features/marketplace/actions";
import type {
  AssignTargets,
  CourseAssignmentRow,
} from "@/features/courses/assignment-queries";
import type { Result } from "@/shared/errors";

import { CourseTools } from "./course-tools";
import { EditorCanvas } from "./editor-canvas";
import { Inspector } from "./inspector";
import { OutlineNav } from "./outline-nav";
import { courseCompleteness, flattenLessons } from "./studio-readiness";
import type { EditorCourse } from "./studio-editor-types";

export type {
  EditorOption,
  EditorQuestion,
  EditorLessonImage,
  EditorLessonAudio,
  EditorLessonItem,
  EditorLesson,
  EditorUnit,
  EditorModule,
  EditorCourse,
} from "./studio-editor-types";

/**
 * The course editor as a 3-pane authoring workspace (T1):
 *   outline navigator (where things are) · editor canvas (what you're editing)
 *   · inspector (what it still needs), under a sticky course header with a
 *   live completeness meter. Course-scoped admin lives in a collapsed
 *   "Course tools" band so the default view stays calm.
 *
 * The selected lesson seeds from `?lesson=` (passed by the server as
 * `initialLessonId`, so SSR and hydration agree), then lives in client state
 * mirrored back to the URL on each pick (deep-linkable, survives
 * router.refresh()). It always derives to a valid lesson, so deleting the open
 * lesson gracefully falls back to the first one. The `run()` orchestration
 * (transition + toast + router.refresh) is unchanged and threaded to every
 * pane, so all existing editing behavior is preserved.
 */
export const StudioEditor = ({
  course,
  initialLessonId,
  assetStatus,
  translationStatus,
  listing,
  isPlatform,
  assignTargets,
  courseAssignments,
}: {
  course: EditorCourse;
  initialLessonId?: number;
  assetStatus: CourseAssetStatus;
  translationStatus: CourseTranslationStatus;
  listing: CourseListingInfo;
  isPlatform: boolean;
  assignTargets: AssignTargets;
  courseAssignments: CourseAssignmentRow[];
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<Result<unknown>>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });

  const flat = useMemo(() => flattenLessons(course), [course]);
  // Seed from the server-resolved ?lesson= (SSR-consistent) so the first render
  // already shows the deep-linked lesson with no hydration mismatch.
  const [selectedId, setSelectedId] = useState<number | null>(
    () => initialLessonId ?? flat[0]?.lesson.id ?? null
  );

  // Always resolve to a real lesson (a stale id — e.g. after deleting the open
  // lesson — falls back to the first).
  const selected =
    flat.find((entry) => entry.lesson.id === selectedId) ?? flat[0] ?? null;

  const select = (lessonId: number) => {
    setSelectedId(lessonId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("lesson", String(lessonId));
      window.history.replaceState(null, "", url.toString());
    }
  };

  const { total, ready } = courseCompleteness(course);
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;

  return (
    // --studio-header-h is the sticky-header height; the outline + inspector
    // panes stick just below it (single source of truth for all three).
    <div className="px-4 pb-16" style={{ "--studio-header-h": "68px" } as CSSProperties}>
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b-2 border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-x-3">
            <Link
              href="/studio"
              title="All courses"
              aria-label="Back to all courses"
              className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-canvas-2 hover:text-ink"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="truncate font-display text-xl font-semibold text-ink">
              {course.title}
            </h1>
            <span
              className={
                course.published
                  ? "shrink-0 rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-700"
                  : "shrink-0 rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold text-gold-700"
              }
            >
              {course.published ? "Published" : "Draft"}
            </span>
          </div>

          <div className="flex items-center gap-x-3">
            {total > 0 && (
              <div
                className="hidden items-center gap-x-2 sm:flex"
                title={`${ready} of ${total} lessons ready to publish`}
              >
                <div className="h-2 w-24 overflow-hidden rounded-full bg-canvas-2">
                  <div
                    className="h-full rounded-full bg-gold-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="whitespace-nowrap font-mono text-xs text-ink-3">
                  {ready}/{total} ready
                </span>
              </div>
            )}

            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  () => publishCourse({ courseId: course.id }),
                  "Published — your crew sees the latest version."
                )
              }
            >
              Publish
            </Button>
            <Button
              variant="dangerOutline"
              disabled={pending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Archive this course? It's hidden from your crew but you can restore it from Studio."
                  )
                )
                  return;
                startTransition(async () => {
                  const result = await archiveCourse({ courseId: course.id });
                  if (!result.ok) {
                    toast.error(result.error.message);
                    return;
                  }
                  toast.success("Course archived.");
                  router.push("/studio");
                });
              }}
            >
              Archive
            </Button>
          </div>
        </div>
      </header>

      <CourseTools
        courseId={course.id}
        assetStatus={assetStatus}
        translationStatus={translationStatus}
        listing={listing}
        isPlatform={isPlatform}
        assignTargets={assignTargets}
        courseAssignments={courseAssignments}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[248px_minmax(0,1fr)_288px]">
        <OutlineNav
          course={course}
          selectedLessonId={selected?.lesson.id ?? null}
          onSelect={select}
          disabled={pending}
          run={run}
        />
        <EditorCanvas
          courseId={course.id}
          flat={selected}
          disabled={pending}
          run={run}
        />
        <Inspector
          courseId={course.id}
          lesson={selected?.lesson ?? null}
          disabled={pending}
        />
      </div>
    </div>
  );
};
