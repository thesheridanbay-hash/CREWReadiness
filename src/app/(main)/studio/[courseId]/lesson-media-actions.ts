import { requeueAsset } from "@/features/courses/actions/course-assets";

/**
 * Re-run AI generation for a single course asset (image or voiceover): requeue
 * it, then hit the generation route. Self-contained and does NOT refresh — the
 * caller awaits it and refreshes once on success. Mirrors the AssetModal
 * regenerate path, shared by the Media tab (voiceover regen) and the inspector's
 * generation queue (retry a failed asset) so the flow lives in one place.
 */
export const requeueAndGenerate = async (
  courseId: number,
  assetId: string
): Promise<{ ok: boolean; message?: string }> => {
  const queued = await requeueAsset({ assetId });
  if (!queued.ok) return { ok: false, message: queued.error.message };

  try {
    const res = await fetch("/api/course/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, assetId }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      failed?: unknown;
      message?: string;
    };
    if (!res.ok) return { ok: false, message: data.message ?? "Generation failed." };
    if (data.failed) {
      return { ok: false, message: "That asset didn't generate — try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Generation took too long — try again." };
  }
};
