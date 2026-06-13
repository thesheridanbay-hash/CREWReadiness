"use client";

import { useRef, useState } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { requeueAsset, setAssetMedia } from "@/actions/course-assets";
import { Button } from "@/components/ui/button";

export type EditableAsset = {
  id: string;
  ref: string;
  kind: "ICON" | "ILLUSTRATION" | "REALISTIC";
  status: "PENDING" | "GENERATING" | "GENERATED" | "FAILED";
  src: string | null;
  prompt: string;
};

/**
 * Feedback-driven asset editor (AI Course Builder). Click any generated image
 * to open this: refine the prompt and regenerate (one immediate run), or upload
 * your own. Both update the asset in place and refresh the editor.
 */
export const AssetModal = ({
  courseId,
  asset,
  onClose,
}: {
  courseId: number;
  asset: EditableAsset;
  onClose: () => void;
}) => {
  const router = useRouter();
  const [prompt, setPrompt] = useState(asset.prompt);
  const [busy, setBusy] = useState<null | "regen" | "upload">(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (message: string) => {
    toast.success(message);
    router.refresh();
    onClose();
  };

  const regenerate = async () => {
    if (busy) return;
    setBusy("regen");
    try {
      const queued = await requeueAsset({
        assetId: asset.id,
        prompt: prompt.trim() || undefined,
      });
      if (!queued.ok) {
        toast.error(queued.error.message);
        return;
      }
      const res = await fetch("/api/course/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, assetId: asset.id }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        failed?: unknown;
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message ?? "Regeneration failed.");
        return;
      }
      if (data.failed) {
        toast.error("That didn't generate — try a different prompt.");
        return;
      }
      done("Image regenerated.");
    } catch {
      toast.error("Regeneration took too long — try again.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File) => {
    if (busy) return;
    setBusy("upload");
    try {
      const up = await fetch("/api/media/upload?kind=PHOTO", {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      const upData = (await up.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!up.ok || !upData.id) {
        toast.error(upData.message ?? "Upload failed.");
        return;
      }
      const attach = await setAssetMedia({ assetId: asset.id, mediaAssetId: upData.id });
      if (!attach.ok) {
        toast.error(attach.error.message);
        return;
      }
      done("Image replaced.");
    } catch {
      toast.error("Upload failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border-2 bg-white p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-x-3">
          <h3 className="text-lg font-bold text-neutral-700">
            Edit image{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {asset.ref} · {asset.kind.toLowerCase()}
            </span>
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 rounded p-1.5 text-neutral-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {asset.src && (
          <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-xl border-2">
            <Image src={asset.src} alt={asset.ref} fill sizes="420px" className="object-cover" />
          </div>
        )}

        <label className="mb-1 block text-sm font-bold text-neutral-700">
          What should change?
        </label>
        <textarea
          className="min-h-24 w-full rounded-xl border-2 px-4 py-2 text-sm outline-none focus:border-green-500"
          placeholder="e.g. wider shot, add safety goggles, brighter daytime lighting…"
          value={prompt}
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Tweak the prompt and regenerate, or upload your own image.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy !== null} onClick={regenerate}>
            {busy === "regen" ? "Regenerating…" : "Regenerate"}
          </Button>
          <Button
            variant="primaryOutline"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {busy === "upload" ? "Uploading…" : "Upload my own"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = "";
            }}
          />
          <div className="flex-1" />
          <Button variant="default" disabled={busy !== null} onClick={onClose}>
            Close
          </Button>
        </div>
        {busy === "regen" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Regenerating takes ~1–2 min — keep this open.
          </p>
        )}
      </div>
    </div>
  );
};
