"use client";

import { useState, type KeyboardEvent } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteLesson, deleteQuestion } from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";

import { AiFieldButton } from "./ai-field-button";
import { AssetModal, type EditableAsset } from "./asset-modal";
import { LessonAnatomyEditor } from "./lesson-anatomy-editor";
import { LessonTeachingEditor } from "./lesson-teaching-editor";
import { requeueAndGenerate } from "./lesson-media-actions";
import { QuestionForm } from "./question-form";
import type { EditorLesson, EditorQuestion } from "./studio-editor-types";
import type { Result } from "@/shared/errors";

type Tab = "teaching" | "items" | "questions" | "media";

/**
 * The lesson editor, as segmented tabs (T3): one section at a time —
 * Teaching · Teach items · Questions · Media — instead of one long stack. The
 * lesson title is the canvas heading (Fraunces) with inline AI-improve; the
 * existing field editors are mounted verbatim as tab panels, so every editing
 * behavior is preserved. Remounted per lesson (keyed by the canvas), so the tab
 * resets to Teaching on a lesson switch.
 */
export const LessonBlock = ({
  courseId,
  lesson,
  disabled,
  run,
}: {
  courseId: number;
  lesson: EditorLesson;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
}) => {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("teaching");
  const [showForm, setShowForm] = useState(false);
  const [editingImage, setEditingImage] = useState<EditableAsset | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<EditorQuestion | null>(null);
  const [regenningAudio, setRegenningAudio] = useState(false);

  const mediaCount = lesson.images.length + (lesson.audio ? 1 : 0);

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "teaching", label: "Teaching" },
    { key: "items", label: "Teach items", count: lesson.items.length },
    { key: "questions", label: "Questions", count: lesson.questions.length },
    { key: "media", label: "Media", count: mediaCount },
  ];

  // Re-run the voiceover (TTS) for this lesson via the shared requeue→generate
  // helper. The reinforced premium-TTS params apply (same generateSpeech path).
  const regenerateVoiceover = async () => {
    if (!lesson.audio || regenningAudio || disabled) return;
    setRegenningAudio(true);
    const result = await requeueAndGenerate(courseId, lesson.audio.id);
    setRegenningAudio(false);
    if (!result.ok) {
      toast.error(result.message ?? "Voiceover regeneration failed.");
      return;
    }
    toast.success("Voiceover regenerated.");
    router.refresh();
  };

  // Roving arrow-key navigation across the tablist (WAI-ARIA tabs pattern).
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const order = tabs.map((entry) => entry.key);
    const index = order.indexOf(tab);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % order.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    if (next === null) return;
    event.preventDefault();
    const key = order[next];
    setTab(key);
    document.getElementById(`tab-${key}`)?.focus();
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-x-3">
        <div className="flex min-w-0 items-center gap-x-2">
          <h2 className="min-w-0 font-display text-lg font-semibold text-ink">
            {lesson.title}
          </h2>
          <AiFieldButton field="lessonTitle" id={lesson.id} label="title" />
        </div>
        <button
          type="button"
          aria-label="Delete lesson"
          title="Delete lesson"
          disabled={disabled}
          onClick={() => run(() => deleteLesson({ id: lesson.id }), "Lesson removed.")}
          className="shrink-0 rounded-md p-1.5 text-ink-3 outline-none transition-colors hover:bg-danger-50 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Lesson sections"
        onKeyDown={onTabKeyDown}
        className="mb-4 inline-flex flex-wrap gap-1 rounded-lg border-2 bg-canvas-2 p-1"
      >
        {tabs.map((entry) => {
          const selected = tab === entry.key;
          return (
            <button
              key={entry.key}
              id={`tab-${entry.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${entry.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(entry.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
                selected ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"
              )}
            >
              {entry.label}
              {entry.count != null && (
                <span className="ml-1.5 font-mono text-xs text-ink-3">{entry.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "teaching" && (
        <div role="tabpanel" id="panel-teaching" aria-labelledby="tab-teaching" tabIndex={0}>
          <LessonTeachingEditor lessonId={lesson.id} initial={lesson.teachingText ?? ""} />
        </div>
      )}

      {tab === "items" && (
        <div role="tabpanel" id="panel-items" aria-labelledby="tab-items" tabIndex={0}>
          <LessonAnatomyEditor
            lessonId={lesson.id}
            items={lesson.items}
            disabled={disabled}
            run={run}
          />
        </div>
      )}

      {tab === "questions" && (
        <div role="tabpanel" id="panel-questions" aria-labelledby="tab-questions" tabIndex={0}>
          {lesson.questions.length === 0 && !showForm && (
            <p className="mb-2 text-sm text-ink-3">No questions yet.</p>
          )}
          <ul className="flex flex-col gap-y-1 text-sm text-ink-2">
            {lesson.questions.map((question) => (
              <li
                key={question.id}
                className="flex items-start justify-between gap-x-2 rounded-lg px-1 py-1"
              >
                <span className="flex-1">{question.question}</span>
                <div className="flex shrink-0 items-center gap-x-1">
                  <AiFieldButton
                    field="questionPrompt"
                    id={question.id}
                    label="question"
                    suggestions={[
                      "Make it a job-site scenario",
                      "Simpler words",
                      "Shorter",
                    ]}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setEditingQuestion(question);
                      setShowForm(false);
                    }}
                    disabled={disabled}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-ink-3 outline-none hover:bg-canvas-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label="Delete question"
                    onClick={() => run(() => deleteQuestion({ id: question.id }))}
                    disabled={disabled}
                    className="rounded-md p-1.5 text-sm font-bold leading-none text-danger outline-none hover:bg-danger-50 focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {editingQuestion ? (
            <QuestionForm
              lessonId={lesson.id}
              editing={editingQuestion}
              disabled={disabled}
              run={run}
              onDone={() => setEditingQuestion(null)}
            />
          ) : showForm ? (
            <QuestionForm
              lessonId={lesson.id}
              disabled={disabled}
              run={run}
              onDone={() => setShowForm(false)}
            />
          ) : (
            <div className="mt-2">
              <Button
                variant="primaryOutline"
                size="sm"
                disabled={disabled}
                onClick={() => setShowForm(true)}
              >
                + Add question
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "media" && (
        <div
          role="tabpanel"
          id="panel-media"
          aria-labelledby="tab-media"
          tabIndex={0}
          className="flex flex-col gap-y-4"
        >
          {mediaCount === 0 && (
            <p className="text-sm text-ink-3">
              No media yet. Generate images and voiceover from{" "}
              <span className="font-semibold text-ink-2">Course tools</span>.
            </p>
          )}

          {lesson.images.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-3">Images</p>
              <div className="flex flex-wrap gap-2">
                {lesson.images.map((img) => (
                  <button
                    type="button"
                    key={img.id}
                    onClick={() =>
                      setEditingImage({
                        id: img.id,
                        ref: img.ref,
                        kind: img.kind,
                        status: img.status,
                        src: img.src,
                        prompt: img.prompt,
                      })
                    }
                    title="Click to regenerate or replace this image"
                    className="group flex flex-col items-center gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {img.src ? (
                      <div className="relative">
                        <Image
                          src={img.src}
                          alt={lesson.title}
                          width={72}
                          height={72}
                          className="h-[72px] w-[72px] rounded-md border object-cover transition group-hover:brightness-90"
                        />
                        <span className="absolute inset-0 hidden items-center justify-center rounded-md bg-ink/50 text-[10px] font-bold text-surface group-hover:flex">
                          Edit
                        </span>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "flex h-[72px] w-[72px] items-center justify-center rounded-md border border-dashed text-xs transition hover:bg-canvas-2",
                          img.status === "FAILED" ? "text-danger" : "text-ink-3"
                        )}
                      >
                        {img.status === "FAILED"
                          ? "failed"
                          : img.status === "GENERATING"
                            ? "…"
                            : "pending"}
                      </div>
                    )}
                    <span className="text-xs text-ink-3">
                      {img.ref} · {img.kind.toLowerCase()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {lesson.audio && (
            <div>
              <div className="mb-1 flex items-center gap-x-2">
                <p className="text-xs font-semibold text-ink-3">Voiceover</p>
                <button
                  type="button"
                  onClick={regenerateVoiceover}
                  disabled={disabled || regenningAudio}
                  title="Regenerate this voiceover with AI (re-runs premium TTS)"
                  className="inline-flex items-center gap-x-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-gold-700 outline-none hover:bg-gold-50 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  ✨ {regenningAudio ? "Regenerating…" : "AI regen"}
                </button>
              </div>
              {regenningAudio ? (
                <p className="text-xs text-gold-700">Regenerating voiceover…</p>
              ) : lesson.audio.src ? (
                <audio controls src={lesson.audio.src} className="h-8 w-full max-w-xs">
                  <track kind="captions" />
                </audio>
              ) : (
                <p
                  className={cn(
                    "text-xs",
                    lesson.audio.status === "FAILED" ? "text-danger" : "text-ink-3"
                  )}
                >
                  {lesson.audio.status === "FAILED" ? "failed" : "pending"}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {editingImage && (
        <AssetModal
          courseId={courseId}
          asset={editingImage}
          onClose={() => setEditingImage(null)}
        />
      )}
    </div>
  );
};
