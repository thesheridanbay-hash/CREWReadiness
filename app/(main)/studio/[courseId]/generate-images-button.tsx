"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { resetFailedAssets, type CourseAssetStatus } from "@/actions/course-assets";
import { Button } from "@/components/ui/button";

/**
 * Drives synchronous, one-at-a-time image generation (AI Course Builder, free
 * tier): POST /api/course/generate-image once per image, awaiting each before
 * the next, until the queue drains. Resumable (re-click continues the remaining
 * PENDING) and a single failure doesn't stop the rest — failures can be retried.
 */
export const GenerateImagesButton = ({
  courseId,
  status,
}: {
  courseId: number;
  status: CourseAssetStatus;
}) => {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(status.pending);
  const [failedSoFar, setFailedSoFar] = useState(0);

  // Not an AI-built course (no image queue) — nothing to show.
  if (status.total === 0) return null;

  const drain = async (): Promise<{ generated: number; failed: number }> => {
    let generated = 0;
    let failed = 0;
    let safety = status.total + status.failed + 5;
    while (safety-- > 0) {
      let data: {
        done?: boolean;
        generated?: unknown;
        failed?: unknown;
        remaining?: number;
        message?: string;
      };
      try {
        const res = await fetch("/api/course/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId }),
          signal: AbortSignal.timeout(290_000),
        });
        data = (await res.json().catch(() => ({}))) as typeof data;
        if (!res.ok) {
          toast.error(data.message ?? "Image generation failed.");
          break;
        }
      } catch {
        toast.error("An image took too long — click to resume from where it stopped.");
        break;
      }
      if (data.done) break;
      if (data.generated) generated += 1;
      if (data.failed) failed += 1;
      setRemaining(data.remaining ?? 0);
      setFailedSoFar(failed);
      if ((data.remaining ?? 0) <= 0) break;
    }
    return { generated, failed };
  };

  const run = async (retryFailed: boolean) => {
    if (running) return;
    setRunning(true);
    setFailedSoFar(0);
    setRemaining(status.pending + (retryFailed ? status.failed : 0));
    try {
      if (retryFailed && status.failed > 0) {
        const reset = await resetFailedAssets({ courseId });
        if (!reset.ok) {
          toast.error(reset.error.message);
          return;
        }
      }
      const { generated, failed } = await drain();
      if (failed > 0) {
        toast.error(`${generated} generated, ${failed} failed — retry to try the failures again.`);
      } else if (generated > 0) {
        toast.success(`Generated ${generated} image${generated === 1 ? "" : "s"}.`);
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  if (status.pending === 0 && status.failed === 0) {
    return (
      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
        ✓ Images ready
      </span>
    );
  }

  const retryMode = status.pending === 0 && status.failed > 0;

  return (
    <div className="flex items-center gap-x-2">
      {running && (
        <span className="text-xs font-medium text-muted-foreground">
          {remaining} left{failedSoFar > 0 ? ` · ${failedSoFar} failed` : ""}
        </span>
      )}
      <Button variant="primaryOutline" disabled={running} onClick={() => run(retryMode)}>
        {running
          ? "Generating…"
          : retryMode
            ? `Retry ${status.failed} failed`
            : `Generate images (${status.pending})`}
      </Button>
    </div>
  );
};
