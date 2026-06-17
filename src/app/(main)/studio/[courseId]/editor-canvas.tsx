"use client";

import { ChevronRight } from "lucide-react";

import type { Result } from "@/shared/errors";

import { LessonBlock } from "./lesson-block";
import type { FlatLesson } from "./studio-readiness";

type Run = (action: () => Promise<Result<unknown>>, success?: string) => void;

/**
 * Center pane: the focused editing surface. Shows one lesson at a time —
 * a breadcrumb (module › unit) for context, then the full lesson editor.
 *
 * T1 mounts the existing `LessonBlock` whole, keyed by lesson id, so switching
 * lessons gives a clean remount (its per-lesson local state resets, which is
 * what you want when you move to a different lesson) and NO existing editing
 * behavior regresses. T3 will split LessonBlock's sections into segmented tabs
 * inside this canvas.
 */
export const EditorCanvas = ({
  courseId,
  flat,
  disabled,
  run,
}: {
  courseId: number;
  flat: FlatLesson | null;
  disabled: boolean;
  run: Run;
}) => {
  if (!flat) {
    return (
      <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-surface px-6 py-16 text-center">
        <h2 className="font-display text-lg font-semibold text-ink">
          Nothing to edit yet
        </h2>
        <p className="mt-1 max-w-xs text-sm text-ink-3">
          Add a module, unit, and lesson from the outline on the left — then pick
          a lesson here to start writing.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Lesson editor" className="min-w-0">
      <nav
        aria-label="Breadcrumb"
        className="mb-3 flex items-center gap-x-1 text-xs font-semibold text-ink-3"
      >
        <span className="truncate">{flat.moduleTitle}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{flat.unitTitle}</span>
      </nav>

      <div className="rounded-2xl border-2 bg-surface p-4 md:p-5">
        <LessonBlock
          key={flat.lesson.id}
          courseId={courseId}
          lesson={flat.lesson}
          disabled={disabled}
          run={run}
        />
      </div>
    </section>
  );
};
