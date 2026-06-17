"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { CornerDownLeft, Search } from "lucide-react";

import { cn } from "@/shared/utils";

import type { FlatLesson } from "./studio-readiness";

/**
 * ⌘K / Ctrl+K palette (T7): fuzzy jump to any lesson by title, module, or unit.
 * Mounted only while open (the parent conditionally renders it), so it starts
 * fresh every time — no reset effect needed. Arrow keys move the highlight,
 * Enter jumps, Escape / backdrop-click closes.
 */
export const CommandPalette = ({
  lessons,
  onJump,
  onClose,
}: {
  lessons: FlatLesson[];
  onJump: (lessonId: number) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const results = (
    q
      ? lessons.filter(
          (entry) =>
            entry.lesson.title.toLowerCase().includes(q) ||
            entry.unitTitle.toLowerCase().includes(q) ||
            entry.moduleTitle.toLowerCase().includes(q)
        )
      : lessons
  ).slice(0, 50);

  const clamped = results.length === 0 ? 0 : Math.min(active, results.length - 1);

  const jump = (entry: FlatLesson) => {
    onJump(entry.lesson.id);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[clamped];
      if (entry) jump(entry);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to a lesson"
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border-2 bg-surface shadow-xl">
        <div className="flex items-center gap-x-2 border-b-2 border-line px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a lesson…"
            aria-label="Jump to a lesson"
            role="combobox"
            aria-expanded
            aria-controls="palette-listbox"
            aria-activedescendant={
              results[clamped] ? `palette-opt-${results[clamped].lesson.id}` : undefined
            }
            className="w-full bg-transparent py-3 text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        <ul
          id="palette-listbox"
          role="listbox"
          aria-label="Lessons"
          className="max-h-[50vh] overflow-y-auto p-1"
        >
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-3">
              No lessons match.
            </li>
          ) : (
            results.map((entry, index) => (
              <li key={entry.lesson.id} role="presentation">
                <button
                  id={`palette-opt-${entry.lesson.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === clamped}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => jump(entry)}
                  className={cn(
                    "flex w-full items-center gap-x-3 rounded-lg px-3 py-2 text-left text-sm outline-none",
                    index === clamped ? "bg-gold-50 text-ink" : "text-ink-2 hover:bg-canvas-2"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {entry.lesson.title}
                  </span>
                  <span className="hidden shrink-0 truncate text-xs text-ink-3 sm:block">
                    {entry.moduleTitle} › {entry.unitTitle}
                  </span>
                  {index === clamped && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
