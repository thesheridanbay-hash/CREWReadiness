"use client";

import { useState } from "react";

import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
  Volume2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  createLesson,
  createModule,
  createUnit,
  deleteModule,
  deleteUnit,
} from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";
import type { Result } from "@/shared/errors";

import type { EditorCourse } from "./studio-editor-types";
import { lessonReadiness, type MediaState } from "./studio-readiness";

type Run = (action: () => Promise<Result<unknown>>, success?: string) => void;

/**
 * Left pane of the studio workspace: the wayfinding the old flat-scroll editor
 * lacked. A collapsible module › unit › lesson tree with a search filter, a
 * per-lesson ready glyph + question count, the active lesson highlighted gold,
 * and inline add/delete affordances. Selecting a lesson focuses the canvas
 * (parent owns the selection); structural edits route through the parent `run`.
 */
export const OutlineNav = ({
  course,
  selectedLessonId,
  onSelect,
  disabled,
  run,
}: {
  course: EditorCourse;
  selectedLessonId: number | null;
  onSelect: (lessonId: number) => void;
  disabled: boolean;
  run: Run;
}) => {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isOpen = (key: string) => filtering || !collapsed.has(key);

  return (
    <nav
      aria-label="Course outline"
      className="rounded-2xl border-2 bg-surface p-2 lg:sticky lg:top-[var(--studio-header-h)] lg:max-h-[calc(100vh-var(--studio-header-h)-20px)] lg:overflow-y-auto"
    >
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a lesson…"
          aria-label="Find a lesson"
          className="w-full rounded-lg border-2 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-brand"
        />
      </div>

      {course.modules.length === 0 && (
        <p className="px-2 py-3 text-sm text-ink-3">
          No modules yet — add one to start building.
        </p>
      )}

      <ul className="flex flex-col gap-y-0.5">
        {course.modules.map((module) => {
          const moduleHit = filtering && module.title.toLowerCase().includes(q);
          const moduleKey = `m${module.id}`;

          const units = module.units
            .map((unit) => {
              const unitHit = filtering && unit.title.toLowerCase().includes(q);
              const lessons = unit.lessons.filter(
                (lesson) =>
                  !filtering ||
                  moduleHit ||
                  unitHit ||
                  lesson.title.toLowerCase().includes(q)
              );
              return { unit, unitHit, lessons };
            })
            .filter(
              ({ unitHit, lessons }) =>
                !filtering || moduleHit || unitHit || lessons.length > 0
            );

          if (filtering && !moduleHit && units.length === 0) return null;

          return (
            <li key={module.id}>
              <div className="group flex items-center gap-x-1">
                <button
                  type="button"
                  onClick={() => toggle(moduleKey)}
                  className="flex min-w-0 flex-1 items-center gap-x-1 rounded-md px-1.5 py-1 text-left outline-none hover:bg-canvas-2 focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {isOpen(moduleKey) ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                    {module.title}
                  </span>
                </button>
                <button
                  type="button"
                  title="Delete module"
                  disabled={disabled}
                  onClick={() =>
                    run(() => deleteModule({ id: module.id }), "Module removed.")
                  }
                  className="rounded-md p-1 text-ink-3 opacity-0 transition-opacity hover:bg-danger-50 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {isOpen(moduleKey) && (
                <div className="ml-2 border-l-2 border-line pl-2">
                  {units.map(({ unit, lessons }) => {
                    const unitKey = `u${unit.id}`;
                    return (
                      <div key={unit.id} className="mt-0.5">
                        <div className="group flex items-center gap-x-1">
                          <button
                            type="button"
                            onClick={() => toggle(unitKey)}
                            className="flex min-w-0 flex-1 items-center gap-x-1 rounded-md px-1.5 py-1 text-left outline-none hover:bg-canvas-2 focus-visible:ring-2 focus-visible:ring-brand"
                          >
                            {isOpen(unitKey) ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-2">
                              {unit.title}
                            </span>
                          </button>
                          <button
                            type="button"
                            title="Delete unit"
                            disabled={disabled}
                            onClick={() =>
                              run(() => deleteUnit({ id: unit.id }), "Unit removed.")
                            }
                            className="rounded-md p-1 text-ink-3 opacity-0 transition-opacity hover:bg-danger-50 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {isOpen(unitKey) && (
                          <div className="ml-2 flex flex-col gap-y-0.5 border-l-2 border-line pl-2">
                            {lessons.map((lesson) => {
                              const readiness = lessonReadiness(lesson);
                              const active = lesson.id === selectedLessonId;
                              return (
                                <button
                                  key={lesson.id}
                                  type="button"
                                  onClick={() => onSelect(lesson.id)}
                                  aria-current={active ? "true" : undefined}
                                  className={cn(
                                    "flex w-full items-center gap-x-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
                                    active
                                      ? "bg-gold-50 font-semibold text-ink"
                                      : "text-ink-2 hover:bg-canvas-2"
                                  )}
                                >
                                  {readiness.ready ? (
                                    <CircleCheck
                                      className="h-4 w-4 shrink-0 text-gold-500"
                                      strokeWidth={2}
                                    />
                                  ) : (
                                    <Circle
                                      className="h-4 w-4 shrink-0 text-line-2"
                                      strokeWidth={2}
                                    />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">
                                    {lesson.title}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-x-1">
                                    <MediaChip state={readiness.imageState} Icon={ImageIcon} label="image" />
                                    <MediaChip state={readiness.voiceState} Icon={Volume2} label="voiceover" />
                                    {readiness.questionCount > 0 && (
                                      <span className="font-mono text-[10px] text-ink-3">
                                        {readiness.questionCount}Q
                                      </span>
                                    )}
                                  </span>
                                </button>
                              );
                            })}
                            <TreeAdd
                              label="Add lesson"
                              placeholder="Lesson title…"
                              disabled={disabled}
                              onAdd={(title) =>
                                run(() => createLesson({ unitId: unit.id, title }))
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <TreeAdd
                    label="Add unit"
                    placeholder="Unit title…"
                    disabled={disabled}
                    onAdd={(title) =>
                      run(() => createUnit({ moduleId: module.id, title }))
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 border-t-2 border-line pt-2">
        <TreeAdd
          label="Add module"
          placeholder="Module title…"
          disabled={disabled}
          onAdd={(title) => run(() => createModule({ courseId: course.id, title }))}
        />
      </div>
    </nav>
  );
};

/** A ghost "+ Add …" row that expands to an inline input on click — keeps the
 * tree calm by default and offers the add affordance only when wanted. */
const TreeAdd = ({
  label,
  placeholder,
  disabled,
  onAdd,
}: {
  label: string;
  placeholder: string;
  disabled: boolean;
  onAdd: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex w-full items-center gap-x-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-ink-3 hover:bg-canvas-2 hover:text-ink disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        {label}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-x-1.5 px-1 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setValue("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        className="w-full rounded-md border-2 px-2 py-1 text-xs outline-none focus:border-brand"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setValue("");
          }
        }}
      />
      <Button
        type="submit"
        variant="primaryOutline"
        size="sm"
        disabled={disabled || !value.trim()}
      >
        Add
      </Button>
    </form>
  );
};

/** Compact media status glyph for a lesson row: present (muted), generating
 * (gold), or failed (danger). Hidden when the lesson has no media of that kind. */
const MediaChip = ({
  state,
  Icon,
  label,
}: {
  state: MediaState;
  Icon: LucideIcon;
  label: string;
}) => {
  if (state === "none") return null;
  const tone =
    state === "failed"
      ? "text-danger"
      : state === "pending"
        ? "text-gold-700"
        : "text-ink-3";
  const title =
    state === "failed"
      ? `${label} failed`
      : state === "pending"
        ? `${label} generating`
        : `${label} ready`;
  return (
    <Icon
      className={cn("h-3 w-3 shrink-0", tone)}
      strokeWidth={2}
      aria-label={title}
    />
  );
};
