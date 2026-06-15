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
    setBusy("tts");
    try {
      // Persist the latest transcript first — the runner reads it from the DB.
      const saved = await updateLessonItem({
        itemId: item.id,
        payload: { ...item.payload, transcript },
      });
      if (!saved.ok) {
        toast.error(saved.error.message);
        return;
      }
      const res = await fetch("/api/lesson-item/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, slot: "audio" }),
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
  const [caption, setCaption] = useState(String(item.payload.caption ?? ""));
  const dirty = caption !== String(item.payload.caption ?? "");

  const save = () =>
    run(
      () => updateLessonItem({ itemId: item.id, payload: { ...item.payload, caption } }),
      "Caption saved."
    );

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <ImageSlot item={item} slot="wrong" label="Don't" disabled={disabled} run={run} />
        <ImageSlot item={item} slot="right" label="Do" disabled={disabled} run={run} />
      </div>
      <div className="mt-2">
        <span className="text-xs font-bold text-ink-3">Caption</span>
        <input
          value={caption}
          disabled={disabled}
          onChange={(e) => setCaption(e.target.value)}
          className={fieldClass}
        />
        {dirty && (
          <div className="mt-1">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={save}>
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const ImageSlot = ({
  item,
  slot,
  label,
  disabled,
  run,
}: {
  item: EditorLessonItem;
  slot: "wrong" | "right";
  label: string;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
}) => {
  const router = useRouter();
  const promptKey = slot === "wrong" ? "wrongPrompt" : "rightPrompt";
  const mediaKey = slot === "wrong" ? "wrongMediaId" : "rightMediaId";
  const [prompt, setPrompt] = useState(String(item.payload[promptKey] ?? ""));
  const [busy, setBusy] = useState<null | "upload" | "gen">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const src = mediaUrl(item.payload[mediaKey]);
  const dirty = prompt !== String(item.payload[promptKey] ?? "");

  const onUpload = async (file: File) => {
    if (busy) return;
    setBusy("upload");
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

  const onGenerate = async () => {
    if (busy) return;
    setBusy("gen");
    try {
      const saved = await updateLessonItem({
        itemId: item.id,
        payload: { ...item.payload, [promptKey]: prompt },
      });
      if (!saved.ok) {
        toast.error(saved.error.message);
        return;
      }
      const res = await fetch("/api/lesson-item/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, slot }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Image generation failed.");
        return;
      }
      toast.success("Image generated.");
      router.refresh();
    } catch {
      toast.error("Generation took too long — try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-y-1">
      <span
        className={
          slot === "right"
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
        disabled={disabled || busy !== null}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={`${label} prompt (for AI)`}
        className={`${fieldClass} text-[11px]`}
      />
      <div className="flex flex-wrap items-center gap-1">
        {dirty && (
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() =>
              run(
                () =>
                  updateLessonItem({
                    itemId: item.id,
                    payload: { ...item.payload, [promptKey]: prompt },
                  }),
                "Prompt saved."
              )
            }
          >
            Save
          </Button>
        )}
        <Button
          variant="primaryOutline"
          size="sm"
          disabled={disabled || busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "upload" ? "…" : "Upload"}
        </Button>
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={onGenerate}
          className="rounded px-1.5 py-1 text-xs font-bold uppercase text-gold-700 hover:bg-gold-50 disabled:opacity-50"
        >
          ✨ {busy === "gen" ? "…" : "AI"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
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
