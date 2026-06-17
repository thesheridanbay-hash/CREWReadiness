"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ClipboardCheck, Search, X } from "lucide-react";
import { toast } from "sonner";

import { archiveCourse, publishCourse } from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";
import type { CourseAssetStatus } from "@/features/courses/actions/course-assets";
import type { CourseTranslationStatus } from "@/features/courses/actions/course-translate";
import type { CourseListingInfo } from "@/features/marketplace/actions";
import type {
  AssignTargets,
  CourseAssignmentRow,
} from "@/features/courses/assignment-queries";
import type { Result } from "@/shared/errors";

import { CommandPalette } from "./command-palette";
import { CourseTools } from "./course-tools";
import { EditorCanvas } from "./editor-canvas";
import { Inspector, InspectorContent } from "./inspector";
import { requeueAndGenerate } from "./lesson-media-actions";
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

  // Mobile is a single-pane drill-down (T6): outline list → tap → editor;
  // the inspector becomes a bottom sheet. These only affect the <lg layout.
  const [mobileView, setMobileView] = useState<"outline" | "editor">(
    initialLessonId ? "editor" : "outline"
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Owned here (not in InspectorContent) so the rail + mobile sheet share one
  // in-flight retry and can't double-fire a regeneration.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Bottom-sheet focus management (WAI-ARIA dialog): focus the close button on
  // open, restore the trigger on close.
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);

  // ⌘K / Ctrl+K toggles the jump palette; Escape closes the mobile sheet.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape" && sheetOpen) {
        setSheetOpen(false);
        sheetTriggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  // Move focus into the sheet when it opens (close button = first control).
  useEffect(() => {
    if (sheetOpen) sheetCloseRef.current?.focus();
  }, [sheetOpen]);

  const closeSheet = () => {
    setSheetOpen(false);
    sheetTriggerRef.current?.focus();
  };

  const select = (lessonId: number) => {
    setSelectedId(lessonId);
    setMobileView("editor");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("lesson", String(lessonId));
      window.history.replaceState(null, "", url.toString());
    }
  };

  const retryAsset = async (assetId: string) => {
    if (retryingId || pending) return;
    setRetryingId(assetId);
    const result = await requeueAndGenerate(course.id, assetId);
    setRetryingId(null);
    if (!result.ok) {
      toast.error(result.message ?? "Retry failed.");
      return;
    }
    toast.success("Regenerating…");
    router.refresh();
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
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title="Jump to a lesson (⌘K)"
              aria-label="Jump to a lesson"
              className="hidden items-center gap-x-1.5 rounded-lg border-2 border-line px-2 py-1.5 text-xs font-semibold text-ink-3 outline-none transition-colors hover:bg-canvas-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand sm:inline-flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="font-mono">⌘K</span>
            </button>
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
        {/* Outline: shown in the mobile "outline" view; always on lg. */}
        <div className={cn("min-w-0", mobileView === "editor" && "hidden lg:block")}>
          <OutlineNav
            course={course}
            selectedLessonId={selected?.lesson.id ?? null}
            onSelect={select}
            disabled={pending}
            run={run}
          />
        </div>

        {/* Canvas: shown in the mobile "editor" view; always on lg. */}
        <div className={cn("min-w-0", mobileView === "outline" && "hidden lg:block")}>
          <div className="mb-3 flex items-center justify-between gap-x-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileView("outline")}
              className="inline-flex items-center gap-x-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink-2 outline-none hover:bg-canvas-2 focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ChevronLeft className="h-4 w-4" />
              Lessons
            </button>
            {selected && (
              <button
                ref={sheetTriggerRef}
                type="button"
                onClick={() => setSheetOpen(true)}
                className="inline-flex items-center gap-x-1.5 rounded-lg border-2 border-line px-2 py-1.5 text-sm font-semibold text-ink-2 outline-none hover:bg-canvas-2 focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ClipboardCheck className="h-4 w-4" />
                Readiness
              </button>
            )}
          </div>
          <EditorCanvas
            courseId={course.id}
            flat={selected}
            disabled={pending}
            run={run}
          />
        </div>

        {/* Inspector: lg right rail (mobile uses the bottom sheet below). */}
        <div className="hidden lg:block">
          <Inspector
            lesson={selected?.lesson ?? null}
            disabled={pending}
            retryingId={retryingId}
            onRetry={retryAsset}
          />
        </div>
      </div>

      {/* Mobile readiness bottom sheet. */}
      {sheetOpen && selected && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Lesson readiness"
        >
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={closeSheet}
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t-2 border-line bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">Lesson readiness</h2>
              <button
                ref={sheetCloseRef}
                type="button"
                onClick={closeSheet}
                aria-label="Close"
                className="rounded-md p-1 text-ink-3 outline-none hover:bg-canvas-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <InspectorContent
              lesson={selected.lesson}
              disabled={pending}
              retryingId={retryingId}
              onRetry={retryAsset}
            />
          </div>
        </div>
      )}

      {/* ⌘K jump-to-lesson palette. */}
      {paletteOpen && (
        <CommandPalette
          lessons={flat}
          onJump={select}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
};
