"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * AI Course Builder wizard (reference items 3 + 5). The owner describes the
 * course (a big idea field plus optional structure) and AI drafts the whole
 * hierarchy. Generation runs in the background (it can take a minute), so on
 * submit we confirm and point at the review queue rather than blocking. Voice
 * note entry is the next iteration (reference item 4).
 */

const inputClass =
  "w-full rounded-xl border-2 px-4 py-2 outline-none focus:border-green-500";

export const AiCourseWizard = () => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ title: string } | null>(null);

  const [idea, setIdea] = useState("");
  const [title, setTitle] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [goals, setGoals] = useState("");
  const [topics, setTopics] = useState("");
  const [employeeLevel, setEmployeeLevel] = useState("");
  const [style, setStyle] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const canSubmit = Boolean(idea.trim() || title.trim() || topics.trim() || goals.trim());

  const reset = () => {
    setDone(null);
    setIdea("");
    setTitle("");
    setUnitCount("");
    setGoals("");
    setTopics("");
    setEmployeeLevel("");
    setStyle("");
  };

  const onSubmit = async () => {
    if (!canSubmit || pending) return;
    setPending(true);
    try {
      // Generation is synchronous (the model takes ~1-2 min); the server route
      // runs under Fluid Compute's 300s budget. Keep the request open for it.
      const res = await fetch("/api/course/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userBrief: idea.trim() || undefined,
          title: title.trim() || undefined,
          unitCount: unitCount ? Number(unitCount) : undefined,
          goals: goals.trim() || undefined,
          topics: topics.trim() || undefined,
          employeeLevel: employeeLevel.trim() || undefined,
          style: style.trim() || undefined,
        }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        title?: string;
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message ?? "Generation failed. Please try again.");
        return;
      }
      setDone({ title: data.title ?? "Your course" });
      toast.success("Course ready in the review queue.");
      router.refresh();
    } catch {
      toast.error(
        "Generation took too long or failed. Your AI provider may be slow — please try again."
      );
    } finally {
      setPending(false);
    }
  };

  if (pending) {
    return (
      <div className="flex flex-col gap-y-3 rounded-2xl border-2 border-sky-200 bg-sky-50 p-6">
        <h3 className="text-lg font-bold text-neutral-700">Generating your course…</h3>
        <p className="text-sm text-muted-foreground">
          AI is drafting the modules, lessons, and questions. This usually takes
          1–2 minutes — keep this tab open. It&apos;ll drop into the review queue
          when it&apos;s done.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-y-3 rounded-2xl border-2 border-green-200 bg-green-50 p-6">
        <h3 className="text-lg font-bold text-neutral-700">
          “{done.title}” is ready ✓
        </h3>
        <p className="text-sm text-muted-foreground">
          Your draft is in the{" "}
          <Link href="/studio/review" className="font-bold text-sky-600 underline">
            review queue
          </Link>
          . Review and approve it to turn it into a real course, then generate
          images.
        </p>
        <div>
          <Button type="button" variant="secondaryOutline" onClick={reset}>
            Build another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-y-4 rounded-2xl border-2 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">
          What should this course teach?
        </label>
        <textarea
          className="min-h-28 w-full rounded-xl border-2 px-4 py-3 text-base outline-none focus:border-green-500"
          placeholder="e.g. Onboarding for new lawn crews — safe mowing on slopes, trimmer handling, loading the trailer, talking to customers. Keep it simple for first-week hires."
          value={idea}
          maxLength={5000}
          onChange={(event) => setIdea(event.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Describe it in plain words — that&apos;s all you need. Add structure
          below only if you want to.
        </p>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-sm font-bold text-sky-600 hover:underline"
        >
          {showDetails ? "− Hide details" : "+ Add details (optional)"}
        </button>
      </div>

      {showDetails && (
        <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Course title <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            className={inputClass}
            placeholder="e.g. Lawn Crew Onboarding"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Number of units <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="e.g. 4"
            value={unitCount}
            onChange={(event) => setUnitCount(event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Employee level <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            className={inputClass}
            placeholder="e.g. brand-new hires"
            value={employeeLevel}
            maxLength={200}
            onChange={(event) => setEmployeeLevel(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Preferred style <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            className={inputClass}
            placeholder="e.g. short, friendly, lots of examples"
            value={style}
            maxLength={200}
            onChange={(event) => setStyle(event.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">
          Topics to cover <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          className={inputClass}
          placeholder="e.g. PPE, slope mowing, trimmer safety, trailer loading"
          value={topics}
          maxLength={2000}
          onChange={(event) => setTopics(event.target.value)}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">
          Goals <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          className={inputClass}
          placeholder="e.g. a new hire can work safely solo by week two"
          value={goals}
          maxLength={2000}
          onChange={(event) => setGoals(event.target.value)}
        />
      </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-muted-foreground">
          Connect your models in{" "}
          <Link href="/platform/settings" className="font-bold underline">
            AI Settings
          </Link>{" "}
          first.
        </p>
        <Button type="submit" variant="secondary" size="lg" disabled={pending || !canSubmit}>
          {pending ? "Starting…" : "Generate course"}
        </Button>
      </div>
    </form>
  );
};
