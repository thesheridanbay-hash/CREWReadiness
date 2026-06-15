"use client";

import { useState } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteLesson, deleteQuestion } from "@/features/courses/actions/content";
import { requeueAsset } from "@/features/courses/actions/course-assets";
import { Button } from "@/shared/ui/button";

import { AiFieldButton } from "./ai-field-button";
import { AssetModal, type EditableAsset } from "./asset-modal";
import { LessonTeachingEditor } from "./lesson-teaching-editor";
import { QuestionForm } from "./question-form";
import { Row } from "./row";
import type { EditorLesson, EditorQuestion } from "./studio-editor-types";
import type { Result } from "@/shared/errors";

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
  const [showForm, setShowForm] = useState(false);
  const [editingImage, setEditingImage] = useState<EditableAsset | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<EditorQuestion | null>(null);
  const [regenningAudio, setRegenningAudio] = useState(false);

  // Re-run the voiceover (TTS) for this lesson if it came out wrong (e.g. the
  // robotic fallback voice). Reuses the per-asset path: requeue → generate. The
  // reinforced premium-TTS prompt/params apply here too, since regeneration
  // goes through the same generateSpeech call as the initial run.
  const regenerateVoiceover = async () => {
    if (!lesson.audio || regenningAudio || disabled) return;
    const audioId = lesson.audio.id;
    setRegenningAudio(true);
    try {
      const queued = await requeueAsset({ assetId: audioId });
      if (!queued.ok) {
        toast.error(queued.error.message);
        return;
      }
      const res = await fetch("/api/course/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, assetId: audioId }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        failed?: unknown;
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message ?? "Voiceover regeneration failed.");
        return;
      }
      if (data.failed) {
        toast.error("That voiceover didn't generate — try again.");
        return;
      }
      toast.success("Voiceover regenerated.");
      router.refresh();
    } catch {
      toast.error("Regeneration took too long — try again.");
    } finally {
      setRegenningAudio(false);
    }
  };

  return (
    <div className="rounded-xl bg-canvas-2 p-3">
      <Row
        label={`Lesson: ${lesson.title} (${lesson.questions.length} q)`}
        onDelete={() => run(() => deleteLesson({ id: lesson.id }), "Lesson removed.")}
        disabled={disabled}
      />

      <LessonTeachingEditor
        lessonId={lesson.id}
        initial={lesson.teachingText ?? ""}
      />

      {lesson.images.length > 0 && (
        <div className="ml-2 mt-2">
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            Images
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
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
                    <span className="absolute inset-0 hidden items-center justify-center rounded-md bg-black/40 text-[10px] font-bold uppercase text-white group-hover:flex">
                      Edit
                    </span>
                  </div>
                ) : (
                  <div
                    className={
                      "flex h-[72px] w-[72px] items-center justify-center rounded-md border border-dashed text-xs transition hover:bg-canvas-2 " +
                      (img.status === "FAILED" ? "text-danger" : "text-neutral-400")
                    }
                  >
                    {img.status === "FAILED"
                      ? "failed"
                      : img.status === "GENERATING"
                        ? "…"
                        : "pending"}
                  </div>
                )}
                <span className="text-xs text-neutral-400">
                  {img.ref} · {img.kind.toLowerCase()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {lesson.audio && (
        <div className="ml-2 mt-2">
          <div className="flex items-center gap-x-2">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Voiceover
            </p>
            <button
              type="button"
              onClick={regenerateVoiceover}
              disabled={disabled || regenningAudio}
              title="Regenerate this voiceover with AI (re-runs premium TTS)"
              className="inline-flex items-center gap-x-1 rounded px-1.5 py-0.5 text-xs font-bold uppercase text-gold-700 hover:bg-gold-50 disabled:opacity-50"
            >
              ✨ {regenningAudio ? "Regenerating…" : "AI regen"}
            </button>
          </div>
          {regenningAudio ? (
            <p className="mt-0.5 text-xs text-gold-700">Regenerating voiceover…</p>
          ) : lesson.audio.src ? (
            <audio controls src={lesson.audio.src} className="mt-1 h-8 w-full max-w-xs">
              <track kind="captions" />
            </audio>
          ) : (
            <p
              className={
                "mt-0.5 text-xs " +
                (lesson.audio.status === "FAILED" ? "text-danger" : "text-neutral-400")
              }
            >
              {lesson.audio.status === "FAILED" ? "failed" : "pending"}
            </p>
          )}
        </div>
      )}

      <ul className="ml-2 mt-2 flex flex-col gap-y-1 pl-1 text-sm text-ink-3">
        {lesson.questions.map((question) => (
          <li key={question.id} className="flex items-start justify-between gap-x-2">
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
                className="rounded px-2 py-1 text-xs font-bold uppercase text-info hover:bg-brand-50 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                aria-label="Delete question"
                onClick={() => run(() => deleteQuestion({ id: question.id }))}
                disabled={disabled}
                className="rounded p-1.5 text-sm font-bold leading-none text-danger hover:bg-danger-50 disabled:opacity-50"
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
