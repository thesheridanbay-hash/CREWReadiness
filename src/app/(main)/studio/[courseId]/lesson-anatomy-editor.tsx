"use client";

import { useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createLessonItem,
  deleteLessonItem,
  moveLessonItem,
  setLessonItemMedia,
  updateLessonItem,
} from "@/features/courses/actions/lesson-items";
import { Button } from "@/shared/ui/button";
import type { LessonItemKind } from "@/features/courses/lesson-item-schema";
import type { Result } from "@/shared/errors";

import type { EditorLessonItem } from "./studio-editor-types";

/**
 * Owner authoring for lesson-anatomy teach items (Phase 2). Lists a lesson's
 * ordered items, lets the owner add each kind, edit its text, reorder, delete,
 * and attach media (upload or AI-generate). Synchronous content edits go
 * through the shared `run` orchestration; media upload/generation are local
 * async flows (fetch → action → refresh).
 */

const KIND_LABEL: Record<LessonItemKind, string> = {
  teaching: "Teaching",
  image_pair: "Image pair",
  voice_note: "Voice note",
  narrative: "Narrative",
};

const ADD_KINDS: LessonItemKind[] = [
  "teaching",
  "image_pair",
  "voice_note",
  "narrative",
];

const fieldClass =
  "mt-1 w-full rounded-lg border-2 px-3 py-2 text-xs leading-relaxed text-ink-3 outline-none focus:border-brand";

const mediaUrl = (id: unknown): string | null =>
  typeof id === "string" && id ? `/api/media/${id}` : null;

export const LessonAnatomyEditor = ({
  lessonId,
  items,
  disabled,
  run,
}: {
  lessonId: number;
  items: EditorLessonItem[];
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
}) => {
  return (
    <div className="ml-2 mt-2">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
        Teach items (anatomy)
      </p>

      {items.length > 0 && (
        <div className="mt-1 flex flex-col gap-y-2">
          {items.map((item, idx) => (
            <ItemRow
              key={item.id}
              item={item}
              isFirst={idx === 0}
              isLast={idx === items.length - 1}
              disabled={disabled}
              run={run}
            />
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-ink-3">Add:</span>
        {ADD_KINDS.map((kind) => (
          <Button
            key={kind}
            variant="primaryOutline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              run(
                () => createLessonItem({ lessonId, kind }),
                `${KIND_LABEL[kind]} item added.`
              )
            }
          >
            + {KIND_LABEL[kind]}
          </Button>
        ))}
      </div>
    </div>
  );
};

const ItemRow = ({
  item,
  isFirst,
  isLast,
  disabled,
  run,
}: {
  item: EditorLessonItem;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
}) => {
  return (
    <div className="rounded-lg border-2 border-line bg-surface p-2">
      <div className="flex items-center justify-between gap-x-2">
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
          {KIND_LABEL[item.kind]}
        </span>
        <div className="flex items-center gap-x-1">
          <button
            type="button"
            aria-label="Move up"
            disabled={disabled || isFirst}
            onClick={() => run(() => moveLessonItem({ itemId: item.id, direction: "up" }))}
            className="rounded px-1.5 py-0.5 text-xs font-bold text-info hover:bg-brand-50 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={disabled || isLast}
            onClick={() => run(() => moveLessonItem({ itemId: item.id, direction: "down" }))}
            className="rounded px-1.5 py-0.5 text-xs font-bold text-info hover:bg-brand-50 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Delete item"
            disabled={disabled}
            onClick={() => run(() => deleteLessonItem({ itemId: item.id }), "Item removed.")}
            className="rounded p-1 text-sm font-bold leading-none text-danger hover:bg-danger-50 disabled:opacity-50"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-2">
        {item.kind === "teaching" && (
          <TextEditor
            item={item}
            disabled={disabled}
            run={run}
            fields={[{ key: "markdown", label: "Teaching (markdown)", area: true }]}
          />
        )}
        {item.kind === "narrative" && (
          <TextEditor
            item={item}
            disabled={disabled}
            run={run}
            fields={[
              { key: "text", label: "Story (markdown)", area: true },
              { key: "hook", label: "Discussion hook", area: false },
            ]}
          />
        )}
        {item.kind === "voice_note" && (
          <VoiceNoteEditor item={item} disabled={disabled} run={run} />
        )}
        {item.kind === "image_pair" && (
          <ImagePairEditor item={item} disabled={disabled} run={run} />
        )}
      </div>
    </div>
  );
};

/** Generic text-fields editor: edits the named payload keys, saves the whole
 * payload (the action re-validates it against the item kind). */
const TextEditor = ({
  item,
  disabled,
  run,
  fields,
}: {
  item: EditorLessonItem;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
  fields: { key: string; label: string; area: boolean }[];
}) => {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, String(item.payload[f.key] ?? "")])
    )
  );

  const dirty = fields.some((f) => draft[f.key] !== String(item.payload[f.key] ?? ""));

  const save = () =>
    run(
      () => updateLessonItem({ itemId: item.id, payload: { ...item.payload, ...draft } }),
      "Item saved."
    );

  return (
    <div>
      {fields.map((f) => (
        <div key={f.key} className="mb-1">
          <span className="text-xs font-bold text-ink-3">{f.label}</span>
          {f.area ? (
            <textarea
              value={draft[f.key]}
              disabled={disabled}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              className={`${fieldClass} min-h-16`}
            />
          ) : (
            <input
              value={draft[f.key]}
              disabled={disabled}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              className={fieldClass}
            />
          )}
        </div>
      ))}
      {dirty && (
        <Button variant="secondary" size="sm" disabled={disabled} onClick={save}>
          Save
        </Button>
      )}
    </div>
  );
};

const VoiceNoteEditor = ({
  item,
  disabled,
  run,
}: {
  item: EditorLessonItem;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
}) => {
  const router = useRouter();
  const [transcript, setTranscript] = useState(String(item.payload.transcript ?? ""));
  const [busy, setBusy] = useState<null | "upload" | "tts">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioSrc = mediaUrl(item.payload.mediaId);
  const dirty = transcript !== String(item.payload.transcript ?? "");

  const save = () =>
    run(
      () => updateLessonItem({ itemId: item.id, payload: { ...item.payload, transcript } }),
      "Transcript saved."
    );

  const onUpload = async (file: File) => {
    if (busy) return;
    setBusy("upload");
    try {
      const up = await fetch("/api/media/upload?kind=VOICE", {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: file,
      });
      const data = (await up.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!up.ok || !data.id) {
        toast.error(data.message ?? "Upload failed.");
        return;
      }
      const attach = await setLessonItemMedia({
        itemId: item.id,
        slot: "audio",
        mediaAssetId: data.id,
      });
      if (!attach.ok) {
        toast.error(attach.error.message);
        return;
      }
      toast.success("Audio attached.");
      router.refresh();
    } catch {
      toast.error("Upload failed.");
    } finally {
      setBusy(null);
    }
  };

  const onGenerate = async () => {
    if (busy) return;
    if (!transcript.trim()) {
      toast.error("Add a transcript first.");
      return;
    }
    setBusy("tts");
    try {
      // Transcript rides in the body so the runner persists it — no separate
      // revalidating save (which caused the jarring mid-click re-render).
      const res = await fetch("/api/lesson-item/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, slot: "audio", prompts: { transcript } }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Voiceover generation failed.");
        return;
      }
      toast.success("Voiceover generated.");
      router.refresh();
    } catch {
      toast.error("Generation took too long — try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <span className="text-xs font-bold text-ink-3">Transcript</span>
      <textarea
        value={transcript}
        disabled={disabled || busy !== null}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="What the voice note says (also used for AI voiceover)."
        className={`${fieldClass} min-h-16`}
      />
      {audioSrc ? (
        <audio controls src={audioSrc} className="mt-1 h-8 w-full max-w-xs">
          <track kind="captions" />
        </audio>
      ) : (
        <p className="mt-1 text-xs text-ink-3">No audio yet — upload or generate.</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {dirty && (
          <Button variant="secondary" size="sm" disabled={disabled} onClick={save}>
            Save
          </Button>
        )}
        <Button
          variant="primaryOutline"
          size="sm"
          disabled={disabled || busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "upload" ? "Uploading…" : "Upload audio"}
        </Button>
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={onGenerate}
          className="inline-flex items-center gap-x-1 rounded px-2 py-1 text-xs font-bold uppercase text-gold-700 hover:bg-gold-50 disabled:opacity-50"
        >
          ✨ {busy === "tts" ? "Generating…" : "AI voiceover"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/webm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
};

const ImagePairEditor = ({
  item,
  disabled,
  run,
}: {
  item: EditorLessonItem;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
}) => {
  const router = useRouter();
  const [caption, setCaption] = useState(String(item.payload.caption ?? ""));
  const [wrongPrompt, setWrongPrompt] = useState(String(item.payload.wrongPrompt ?? ""));
  const [rightPrompt, setRightPrompt] = useState(String(item.payload.rightPrompt ?? ""));
  const [busy, setBusy] = useState<null | "pair" | "upload-wrong" | "upload-right">(null);

  const dirty =
    caption !== String(item.payload.caption ?? "") ||
    wrongPrompt !== String(item.payload.wrongPrompt ?? "") ||
    rightPrompt !== String(item.payload.rightPrompt ?? "");

  const save = () =>
    run(
      () =>
        updateLessonItem({
          itemId: item.id,
          payload: { ...item.payload, caption, wrongPrompt, rightPrompt },
        }),
      "Saved."
    );

  // ONE coherent generation: the DO first, then the DON'T anchored to the same
  // scene (server-side) so the pair actually matches. Prompts ride in the body
  // → no separate revalidating save (that caused the mid-click re-render). The
  // editor refreshes once, after both images land.
  const generatePair = async () => {
    if (busy) return;
    if (!wrongPrompt.trim() || !rightPrompt.trim()) {
      toast.error("Add both a DO and a DON'T prompt first.");
      return;
    }
    setBusy("pair");
    try {
      const res = await fetch("/api/lesson-item/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          slot: "pair",
          prompts: { wrongPrompt, rightPrompt },
        }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Pair generation failed.");
        return;
      }
      toast.success("Image pair generated.");
      router.refresh();
    } catch {
      toast.error("Generation took too long — try again.");
    } finally {
      setBusy(null);
    }
  };

  const upload = async (slot: "wrong" | "right", file: File) => {
    if (busy) return;
    setBusy(`upload-${slot}`);
    try {
      const up = await fetch("/api/media/upload?kind=PHOTO", {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      const data = (await up.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!up.ok || !data.id) {
        toast.error(data.message ?? "Upload failed.");
        return;
      }
      const attach = await setLessonItemMedia({ itemId: item.id, slot, mediaAssetId: data.id });
      if (!attach.ok) {
        toast.error(attach.error.message);
        return;
      }
      toast.success("Image attached.");
      router.refresh();
    } catch {
      toast.error("Upload failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <PairColumn
          tone="wrong"
          label="Don't"
          src={mediaUrl(item.payload.wrongMediaId)}
          prompt={wrongPrompt}
          onPromptChange={setWrongPrompt}
          onUpload={(f) => void upload("wrong", f)}
          uploading={busy === "upload-wrong"}
          disabled={disabled || busy !== null}
        />
        <PairColumn
          tone="right"
          label="Do"
          src={mediaUrl(item.payload.rightMediaId)}
          prompt={rightPrompt}
          onPromptChange={setRightPrompt}
          onUpload={(f) => void upload("right", f)}
          uploading={busy === "upload-right"}
          disabled={disabled || busy !== null}
        />
      </div>

      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={generatePair}
        className="mt-2 inline-flex items-center gap-x-1 rounded-lg bg-gold-50 px-3 py-1.5 text-xs font-bold uppercase text-gold-700 hover:bg-gold-50/70 disabled:opacity-50"
      >
        ✨ {busy === "pair" ? "Generating pair…" : "Generate pair (DO + DON'T)"}
      </button>

      <div className="mt-2">
        <span className="text-xs font-bold text-ink-3">Caption</span>
        <input
          value={caption}
          disabled={disabled || busy !== null}
          onChange={(e) => setCaption(e.target.value)}
          className={fieldClass}
        />
      </div>

      {dirty && (
        <div className="mt-1.5">
          <Button variant="secondary" size="sm" disabled={disabled} onClick={save}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
};

/** One side of an image pair: preview + scene/behavior prompt + manual upload.
 * Generation lives at the pair level (the "Generate pair" button) so the two
 * sides come out as one coherent scene. */
const PairColumn = ({
  tone,
  label,
  src,
  prompt,
  onPromptChange,
  onUpload,
  uploading,
  disabled,
}: {
  tone: "wrong" | "right";
  label: string;
  src: string | null;
  prompt: string;
  onPromptChange: (v: string) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
  disabled: boolean;
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-y-1">
      <span
        className={
          tone === "right"
            ? "self-start rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold uppercase text-success-700"
            : "self-start rounded-full bg-danger-50 px-2 py-0.5 text-xs font-bold uppercase text-danger-600"
        }
      >
        {label}
      </span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="aspect-square w-full rounded-lg border-2 object-cover" />
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-line text-xs text-ink-3">
          none
        </div>
      )}
      <input
        value={prompt}
        disabled={disabled}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={`${label} scene/behavior (for AI)`}
        className={`${fieldClass} text-[11px]`}
      />
      <Button
        type="button"
        variant="primaryOutline"
        size="sm"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? "…" : "Upload"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
};
