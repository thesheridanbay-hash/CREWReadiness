"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type {
  CourseLanguageProgress,
  CourseTranslationStatus,
} from "@/features/courses/actions/course-translate";
import { Button } from "@/shared/ui/button";
import { languageLabel } from "@/features/courses/languages";

/**
 * Owner-facing "Translate to <language>" control (AI Course Builder,
 * multi-language). One row per non-primary language with live progress.
 *
 * Same free-tier strategy as image generation: POST /api/course/translate in a
 * client loop, awaiting each batch (the route drains as many lessons as fit
 * under its budget) until done. Resumable — a re-click picks up the remaining
 * untranslated lessons; a failure stops cleanly and the owner can resume.
 */
export const TranslatePanel = ({
  courseId,
  status,
}: {
  courseId: number;
  status: CourseTranslationStatus;
}) => {
  const router = useRouter();
  const [activeLang, setActiveLang] = useState<string | null>(null);
  // Live translated-count per language while a run is in flight.
  const [live, setLive] = useState<Record<string, number>>({});

  // Nothing to translate (no lessons yet) or only the primary is supported.
  if (status.totalLessons === 0 || status.languages.length === 0) return null;

  const translate = async (lang: string, startFrom: number) => {
    if (activeLang) return;
    setActiveLang(lang);
    setLive((prev) => ({ ...prev, [lang]: startFrom }));

    try {
      // Safety bound: at most one batch-call per lesson, plus slack.
      let safety = status.totalLessons + 5;
      while (safety-- > 0) {
        let data: {
          done?: boolean;
          remaining?: number;
          failed?: { message: string } | null;
          message?: string;
        };
        try {
          const res = await fetch("/api/course/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId, lang }),
            signal: AbortSignal.timeout(290_000),
          });
          data = (await res.json().catch(() => ({}))) as typeof data;
          if (!res.ok) {
            toast.error(data.message ?? "Translation failed.");
            break;
          }
        } catch {
          toast.error("That took too long — click to resume where it stopped.");
          break;
        }

        const remaining = data.remaining ?? 0;
        setLive((prev) => ({ ...prev, [lang]: status.totalLessons - remaining }));

        if (data.failed) {
          toast.error("A lesson didn't translate — click to resume the rest.");
          break;
        }
        if (data.done || remaining <= 0) {
          if (data.done) toast.success(`Translated to ${languageLabel(lang)}.`);
          break;
        }
      }
    } finally {
      setActiveLang(null);
      router.refresh();
    }
  };

  return (
    <section className="mb-6 rounded-2xl border-2 p-4">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Languages
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Base content is in {languageLabel(status.primaryLanguage)}. Generate a
        translation so crew members set to that language see it.
      </p>
      <div className="flex flex-col gap-y-2">
        {status.languages.map((language) => (
          <LanguageRow
            key={language.code}
            language={language}
            busy={activeLang !== null}
            running={activeLang === language.code}
            doneCount={live[language.code] ?? language.translated}
            onTranslate={(startFrom) => translate(language.code, startFrom)}
          />
        ))}
      </div>
    </section>
  );
};

const LanguageRow = ({
  language,
  busy,
  running,
  doneCount,
  onTranslate,
}: {
  language: CourseLanguageProgress;
  busy: boolean;
  running: boolean;
  doneCount: number;
  onTranslate: (startFrom: number) => void;
}) => {
  const total = language.total;
  const complete = !running && doneCount >= total && total > 0;
  const started = doneCount > 0 && doneCount < total;

  const label = running
    ? `Translating… ${doneCount}/${total}`
    : started
      ? `Resume (${total - doneCount} left)`
      : `Translate to ${language.label}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 p-3">
      <div className="flex items-center gap-x-2">
        <span className="font-bold text-neutral-700">{language.label}</span>
        {complete ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
            ✓ Up to date
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {doneCount}/{total} lessons
          </span>
        )}
      </div>
      {/* The route only translates UNtranslated lessons, so a complete language
          has nothing to do — show the badge, no button. Adding a lesson later
          drops the count and brings back "Resume". */}
      {!complete && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => onTranslate(started ? doneCount : 0)}
        >
          {label}
        </Button>
      )}
    </div>
  );
};
