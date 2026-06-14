"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import type { GenerationAttempt } from "@/features/courses/review-queries";

/**
 * Course-generation attempts that failed or stalled (bugfix). Shows the captured
 * error and a Retry that re-runs generation from the saved inputs — so a missed
 * call is recoverable from the queue instead of disappearing.
 */
export const GenerationAttempts = ({
  attempts,
}: {
  attempts: GenerationAttempt[];
}) => {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  // While a background job is still running, poll the server component so the
  // queue updates itself: the "Generating…" row turns into a draft (or a
  // failure) without the owner refreshing the page.
  const hasRunning = attempts.some(
    (attempt) => attempt.status === "RUNNING" && !attempt.stale
  );
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(id);
  }, [hasRunning, router]);

  if (attempts.length === 0) return null;

  const retry = async (jobId: string) => {
    if (busyId) return;
    setBusyId(jobId);
    try {
      const res = await fetch("/api/course/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryJobId: jobId }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Still failing — check your AI provider.");
        router.refresh();
        return;
      }
      toast.success("Course drafted — it's in the queue below.");
      router.refresh();
    } catch {
      toast.error("Took too long again. The provider may be slow; try once more.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Generation attempts
      </h2>
      <div className="flex flex-col gap-y-2">
        {attempts.map((attempt) => {
          const running = attempt.status === "RUNNING" && !attempt.stale;
          return (
            <div
              key={attempt.jobId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-x-2">
                  <span className="truncate font-medium text-neutral-700">
                    {attempt.title}
                  </span>
                  {running ? (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">
                      Generating…
                    </span>
                  ) : (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                      {attempt.status === "RUNNING" ? "Stalled" : "Failed"}
                    </span>
                  )}
                </div>
                {attempt.error && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {attempt.error}
                  </p>
                )}
              </div>
              <Button
                variant="primaryOutline"
                disabled={busyId !== null || running}
                onClick={() => retry(attempt.jobId)}
              >
                {busyId === attempt.jobId ? "Retrying…" : "Retry"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
};
