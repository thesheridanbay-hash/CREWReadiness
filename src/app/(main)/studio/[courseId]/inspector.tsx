"use client";

import { CircleAlert, CircleCheck, Circle, Loader2 } from "lucide-react";

import { cn } from "@/shared/utils";

import type { EditorLesson } from "./studio-editor-types";
import { lessonReadiness, type MediaState } from "./studio-readiness";

type RowState = "done" | "todo" | "pending" | "failed" | "none";

/** Shared retry state, owned by the shell so the desktop rail and the mobile
 * sheet (two InspectorContent instances) never double-fire a regeneration. */
type RetryProps = {
  retryingId: string | null;
  onRetry: (assetId: string) => void;
};

/**
 * Right pane: per-lesson publish-readiness checklist + a consolidated
 * generation queue. The queue replaces the old scattered "pending" thumbnails —
 * it lists every in-flight asset (with a spinner) and every failed one (with a
 * gold Retry that re-runs generation via the shared requeue→generate helper).
 *
 * `Inspector` is the sticky right-rail wrapper (lg+); `InspectorContent` is the
 * bare content, reused inside the mobile bottom sheet (T6).
 */
export const Inspector = ({
  lesson,
  disabled,
  retryingId,
  onRetry,
}: {
  lesson: EditorLesson | null;
  disabled: boolean;
} & RetryProps) => {
  if (!lesson) {
    return (
      <aside
        aria-label="Lesson inspector"
        className="rounded-2xl border-2 bg-surface p-4 text-sm text-ink-3 lg:sticky lg:top-[var(--studio-header-h)]"
      >
        Select a lesson to see what it still needs.
      </aside>
    );
  }

  return (
    <aside
      aria-label="Lesson inspector"
      className="rounded-2xl border-2 bg-surface p-4 lg:sticky lg:top-[var(--studio-header-h)] lg:max-h-[calc(100vh-var(--studio-header-h)-20px)] lg:overflow-y-auto"
    >
      <InspectorContent
        lesson={lesson}
        disabled={disabled}
        retryingId={retryingId}
        onRetry={onRetry}
      />
    </aside>
  );
};

/** The inspector's body (readiness checklist + generation queue), without the
 * card/sticky chrome — rendered in the right rail and in the mobile sheet. */
export const InspectorContent = ({
  lesson,
  disabled,
  retryingId,
  onRetry,
}: {
  lesson: EditorLesson;
  disabled: boolean;
} & RetryProps) => {
  const readiness = lessonReadiness(lesson);

  const pendingImages = lesson.images.filter(
    (image) => image.status === "PENDING" || image.status === "GENERATING"
  );
  const failedImages = lesson.images.filter((image) => image.status === "FAILED");
  const audioPending =
    lesson.audio?.status === "PENDING" || lesson.audio?.status === "GENERATING";
  const audioFailed = lesson.audio?.status === "FAILED";
  const mediaCount = lesson.images.length + (lesson.audio ? 1 : 0);
  const hasQueue =
    pendingImages.length > 0 || failedImages.length > 0 || audioPending || audioFailed;

  return (
    <div className="flex flex-col gap-y-4">
      <section className="flex flex-col gap-y-3">
        <div className="flex items-center justify-between gap-x-2">
          <h2 className="text-sm font-bold text-ink">Ready to ship</h2>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              readiness.ready ? "bg-gold-50 text-brand-800" : "bg-canvas-2 text-ink-3"
            )}
          >
            {readiness.ready ? "Ready" : "In progress"}
          </span>
        </div>

        <ul className="flex flex-col gap-y-2 text-sm">
          <ChecklistRow
            state={readiness.hasTeaching ? "done" : "todo"}
            label={readiness.hasTeaching ? "Teaching content" : "Add teaching content"}
          />
          <ChecklistRow
            state={readiness.questionCount >= 1 ? "done" : "todo"}
            label={
              readiness.questionCount >= 1
                ? `${readiness.questionCount} question${readiness.questionCount === 1 ? "" : "s"}`
                : "Add a question"
            }
          />
          <ChecklistRow
            state={mediaRowState(readiness.imageState)}
            label={mediaLabel("Images", readiness.imageState)}
            muted
          />
          <ChecklistRow
            state={mediaRowState(readiness.voiceState)}
            label={mediaLabel("Voiceover", readiness.voiceState)}
            muted
          />
        </ul>
      </section>

      {mediaCount > 0 && (
        <section className="flex flex-col gap-y-2 border-t-2 border-line pt-3">
          <h3 className="text-sm font-bold text-ink">Generation</h3>

          {!hasQueue ? (
            <p className="flex items-center gap-x-2 text-sm text-ink-3">
              <CircleCheck className="h-4 w-4 shrink-0 text-gold-500" strokeWidth={2} />
              All media generated.
            </p>
          ) : (
            <ul className="flex flex-col gap-y-2 text-sm">
              {pendingImages.map((image) => (
                <QueueRow key={image.id} state="pending" label={`Image ${image.ref}`} />
              ))}
              {failedImages.map((image) => (
                <QueueRow
                  key={image.id}
                  state="failed"
                  label={`Image ${image.ref}`}
                  onRetry={() => onRetry(image.id)}
                  retrying={retryingId === image.id}
                  disabled={disabled || retryingId !== null}
                />
              ))}
              {lesson.audio && audioPending && (
                <QueueRow state="pending" label="Voiceover" />
              )}
              {lesson.audio && audioFailed && (
                <QueueRow
                  state="failed"
                  label="Voiceover"
                  onRetry={() => onRetry(lesson.audio!.id)}
                  retrying={retryingId === lesson.audio.id}
                  disabled={disabled || retryingId !== null}
                />
              )}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};

const QueueRow = ({
  state,
  label,
  onRetry,
  retrying,
  disabled,
}: {
  state: "pending" | "failed";
  label: string;
  onRetry?: () => void;
  retrying?: boolean;
  disabled?: boolean;
}) => (
  <li className="flex items-center gap-x-2">
    {state === "pending" ? (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />
    ) : (
      <CircleAlert className="h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
    )}
    <span className={cn("min-w-0 flex-1", state === "failed" ? "text-ink-2" : "text-ink-3")}>
      {label}
      {state === "pending" && " — generating…"}
    </span>
    {state === "failed" && onRetry && (
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        className="shrink-0 rounded-md bg-gold-500 px-2 py-0.5 text-xs font-semibold text-brand-800 outline-none transition-colors hover:bg-gold-500/90 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    )}
  </li>
);

const ChecklistRow = ({
  state,
  label,
  muted,
}: {
  state: RowState;
  label: string;
  muted?: boolean;
}) => (
  <li className="flex items-center gap-x-2">
    <RowIcon state={state} />
    <span
      className={cn(
        "min-w-0 flex-1",
        state === "done" ? "text-ink" : muted ? "text-ink-3" : "text-ink-2"
      )}
    >
      {label}
    </span>
  </li>
);

const RowIcon = ({ state }: { state: RowState }) => {
  switch (state) {
    case "done":
      return <CircleCheck className="h-4 w-4 shrink-0 text-gold-500" strokeWidth={2} />;
    case "pending":
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />;
    case "failed":
      return <CircleAlert className="h-4 w-4 shrink-0 text-danger" strokeWidth={2} />;
    default:
      return <Circle className="h-4 w-4 shrink-0 text-line-2" strokeWidth={2} />;
  }
};

const mediaRowState = (media: MediaState): RowState => {
  switch (media) {
    case "ready":
      return "done";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    default:
      return "none";
  }
};

const mediaLabel = (noun: string, media: MediaState): string => {
  switch (media) {
    case "ready":
      return `${noun} ready`;
    case "pending":
      return `${noun} generating`;
    case "failed":
      return `${noun} failed`;
    default:
      return `No ${noun.toLowerCase()}`;
  }
};
