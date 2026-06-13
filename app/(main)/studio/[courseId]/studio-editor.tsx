"use client";

import { useState, useTransition } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createLesson,
  createModule,
  createQuestion,
  createUnit,
  deleteLesson,
  deleteModule,
  deleteQuestion,
  deleteUnit,
  publishCourse,
  updateQuestion,
} from "@/actions/content";
import { Button } from "@/components/ui/button";
import type { CourseAssetStatus } from "@/actions/course-assets";
import type { CourseTranslationStatus } from "@/actions/course-translate";
import type { CourseListingInfo } from "@/actions/marketplace";
import type {
  AssignTargets,
  CourseAssignmentRow,
} from "@/lib/content/assignment-queries";
import type { Result } from "@/lib/errors";

import { AssetModal, type EditableAsset } from "./asset-modal";
import { AssignPanel } from "./assign-panel";
import { GenerateImagesButton } from "./generate-images-button";
import { MarketplacePublishPanel } from "./marketplace-publish-panel";
import { TranslatePanel } from "./translate-panel";

export type EditorOption = { id: number; text: string; correct: boolean };
export type EditorQuestion = {
  id: number;
  question: string;
  type: "SELECT" | "ASSIST";
  explanation: string | null;
  options: EditorOption[];
};
export type EditorLessonImage = {
  id: string;
  ref: string;
  kind: "ICON" | "ILLUSTRATION" | "REALISTIC";
  status: "PENDING" | "GENERATING" | "GENERATED" | "FAILED";
  src: string | null;
  prompt: string;
};
export type EditorLessonAudio = {
  status: "PENDING" | "GENERATING" | "GENERATED" | "FAILED";
  src: string | null;
};
export type EditorLesson = {
  id: number;
  title: string;
  teachingText: string | null;
  images: EditorLessonImage[];
  audio: EditorLessonAudio | null;
  questions: EditorQuestion[];
};
export type EditorUnit = { id: number; title: string; lessons: EditorLesson[] };
export type EditorModule = { id: number; title: string; units: EditorUnit[] };
export type EditorCourse = {
  id: number;
  title: string;
  published: boolean;
  modules: EditorModule[];
};

const inputClass =
  "w-full rounded-lg border-2 px-3 py-1.5 text-sm outline-none focus:border-green-500";

export const StudioEditor = ({
  course,
  assetStatus,
  translationStatus,
  listing,
  isPlatform,
  assignTargets,
  courseAssignments,
}: {
  course: EditorCourse;
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

  return (
    <div className="mt-3">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-x-3">
          <h1 className="text-2xl font-bold text-neutral-700">{course.title}</h1>
          <span
            className={
              course.published
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700"
                : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700"
            }
          >
            {course.published ? "Published" : "Draft"}
          </span>
        </div>
        <div className="flex items-center gap-x-2">
          <GenerateImagesButton courseId={course.id} status={assetStatus} />
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
        </div>
      </div>

      <AssignPanel
        courseId={course.id}
        targets={assignTargets}
        current={courseAssignments}
      />

      <TranslatePanel courseId={course.id} status={translationStatus} />

      <MarketplacePublishPanel
        courseId={course.id}
        listing={listing}
        isPlatform={isPlatform}
      />

      <div className="flex flex-col gap-y-4">
        {course.modules.map((module) => (
          <section key={module.id} className="rounded-2xl border-2 p-4">
            <Row
              label={`Module: ${module.title}`}
              onDelete={() => run(() => deleteModule({ id: module.id }), "Module removed.")}
              disabled={pending}
            />

            <div className="ml-4 mt-3 flex flex-col gap-y-3 border-l-2 pl-4">
              {module.units.map((unit) => (
                <div key={unit.id}>
                  <Row
                    label={`Unit: ${unit.title}`}
                    onDelete={() => run(() => deleteUnit({ id: unit.id }), "Unit removed.")}
                    disabled={pending}
                  />
                  <div className="ml-4 mt-2 flex flex-col gap-y-2 border-l-2 pl-4">
                    {unit.lessons.map((lesson) => (
                      <LessonBlock
                        key={lesson.id}
                        courseId={course.id}
                        lesson={lesson}
                        disabled={pending}
                        run={run}
                      />
                    ))}
                    <InlineAdd
                      placeholder="Add lesson…"
                      disabled={pending}
                      onAdd={(title) =>
                        run(() => createLesson({ unitId: unit.id, title }))
                      }
                    />
                  </div>
                </div>
              ))}
              <InlineAdd
                placeholder="Add unit…"
                disabled={pending}
                onAdd={(title) => run(() => createUnit({ moduleId: module.id, title }))}
              />
            </div>
          </section>
        ))}

        <div className="rounded-2xl border-2 border-dashed p-4">
          <InlineAdd
            placeholder="Add module…"
            disabled={pending}
            onAdd={(title) => run(() => createModule({ courseId: course.id, title }))}
          />
        </div>
      </div>
    </div>
  );
};

const Row = ({
  label,
  onDelete,
  disabled,
}: {
  label: string;
  onDelete: () => void;
  disabled: boolean;
}) => (
  <div className="flex items-center justify-between">
    <span className="font-bold text-neutral-700">{label}</span>
    <button
      type="button"
      onClick={onDelete}
      disabled={disabled}
      className="text-xs font-bold uppercase text-rose-500 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  </div>
);

const LessonBlock = ({
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
  const [showForm, setShowForm] = useState(false);
  const [showTeaching, setShowTeaching] = useState(false);
  const [editingImage, setEditingImage] = useState<EditableAsset | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<EditorQuestion | null>(null);

  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <Row
        label={`Lesson: ${lesson.title} (${lesson.questions.length} q)`}
        onDelete={() => run(() => deleteLesson({ id: lesson.id }), "Lesson removed.")}
        disabled={disabled}
      />

      {lesson.teachingText && (
        <div className="ml-2 mt-2">
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            Teaching
          </p>
          <p
            className={
              "mt-0.5 whitespace-pre-wrap text-xs text-neutral-500" +
              (showTeaching ? "" : " line-clamp-3")
            }
          >
            {lesson.teachingText}
          </p>
          {lesson.teachingText.length > 160 && (
            <button
              type="button"
              onClick={() => setShowTeaching((v) => !v)}
              className="mt-0.5 text-xs font-bold text-sky-600 hover:underline"
            >
              {showTeaching ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

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
                className="group flex flex-col items-center gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
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
                      "flex h-[72px] w-[72px] items-center justify-center rounded-md border border-dashed text-xs transition hover:bg-slate-50 " +
                      (img.status === "FAILED" ? "text-rose-500" : "text-neutral-400")
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
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            Voiceover
          </p>
          {lesson.audio.src ? (
            <audio controls src={lesson.audio.src} className="mt-1 h-8 w-full max-w-xs">
              <track kind="captions" />
            </audio>
          ) : (
            <p
              className={
                "mt-0.5 text-xs " +
                (lesson.audio.status === "FAILED" ? "text-rose-500" : "text-neutral-400")
              }
            >
              {lesson.audio.status === "FAILED" ? "failed" : "pending"}
            </p>
          )}
        </div>
      )}

      <ul className="ml-2 mt-2 flex flex-col gap-y-1 pl-1 text-sm text-neutral-600">
        {lesson.questions.map((question) => (
          <li key={question.id} className="flex items-start justify-between gap-x-2">
            <span className="flex-1">{question.question}</span>
            <div className="flex shrink-0 items-center gap-x-1">
              <button
                type="button"
                onClick={() => {
                  setEditingQuestion(question);
                  setShowForm(false);
                }}
                disabled={disabled}
                className="rounded px-2 py-1 text-xs font-bold uppercase text-sky-600 hover:bg-sky-50 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                aria-label="Delete question"
                onClick={() => run(() => deleteQuestion({ id: question.id }))}
                disabled={disabled}
                className="rounded p-1.5 text-sm font-bold leading-none text-rose-400 hover:bg-rose-50 disabled:opacity-50"
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

const QuestionForm = ({
  lessonId,
  editing,
  disabled,
  run,
  onDone,
}: {
  lessonId: number;
  editing?: EditorQuestion;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
  onDone: () => void;
}) => {
  const [question, setQuestion] = useState(editing?.question ?? "");
  const [explanation, setExplanation] = useState(editing?.explanation ?? "");
  const [options, setOptions] = useState<EditorOption[]>(
    editing
      ? editing.options.map((o, i) => ({ id: i, text: o.text, correct: o.correct }))
      : [
          { id: 0, text: "", correct: true },
          { id: 1, text: "", correct: false },
        ]
  );

  const setOption = (index: number, patch: Partial<EditorOption>) =>
    setOptions((prev) =>
      prev.map((option, i) => (i === index ? { ...option, ...patch } : option))
    );

  const submit = () => {
    const cleaned = options
      .map((option) => ({ text: option.text.trim(), correct: option.correct }))
      .filter((option) => option.text.length > 0);

    if (!question.trim() || cleaned.length < 2) {
      toast.error("Add a question and at least two answer options.");
      return;
    }
    if (!cleaned.some((option) => option.correct)) {
      toast.error("Mark one option correct.");
      return;
    }

    run(
      () =>
        editing
          ? updateQuestion({
              questionId: editing.id,
              question,
              explanation: explanation || undefined,
              options: cleaned,
            })
          : createQuestion({
              lessonId,
              type: "SELECT",
              question,
              explanation: explanation || undefined,
              options: cleaned,
            }),
      editing ? "Question updated." : "Question added."
    );
    onDone();
  };

  return (
    <div className="mt-2 flex flex-col gap-y-2 rounded-lg border-2 border-sky-200 p-3">
      <input
        className={inputClass}
        placeholder="Question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <input
        className={inputClass}
        placeholder="Why the right answer matters (shown when they miss)"
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
      />
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-x-2">
          <input
            type="radio"
            name={`correct-${lessonId}`}
            checked={option.correct}
            onChange={() =>
              setOptions((prev) =>
                prev.map((o, i) => ({ ...o, correct: i === index }))
              )
            }
          />
          <input
            className={inputClass}
            placeholder={`Option ${index + 1}`}
            value={option.text}
            onChange={(event) => setOption(index, { text: event.target.value })}
          />
        </div>
      ))}
      <div className="flex items-center gap-x-2">
        {options.length < 6 && (
          <button
            type="button"
            onClick={() =>
              setOptions((prev) => [...prev, { id: prev.length, text: "", correct: false }])
            }
            className="text-xs font-bold uppercase text-sky-600 hover:underline"
          >
            + Option
          </button>
        )}
        <div className="flex-1" />
        <Button variant="secondary" disabled={disabled} onClick={submit}>
          Save
        </Button>
        <Button variant="default" disabled={disabled} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

const InlineAdd = ({
  placeholder,
  onAdd,
  disabled,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
  disabled: boolean;
}) => {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-x-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return;
        onAdd(value.trim());
        setValue("");
      }}
    >
      <input
        className={inputClass}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" variant="primaryOutline" disabled={disabled || !value.trim()}>
        Add
      </Button>
    </form>
  );
};
