"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { requestCourseGeneration } from "@/actions/course-builder";
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
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  const [idea, setIdea] = useState("");
  const [title, setTitle] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [goals, setGoals] = useState("");
  const [topics, setTopics] = useState("");
  const [employeeLevel, setEmployeeLevel] = useState("");
  const [style, setStyle] = useState("");

  const canSubmit = Boolean(idea.trim() || title.trim() || topics.trim() || goals.trim());

  const onSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await requestCourseGeneration({
        userBrief: idea.trim() || undefined,
        title: title.trim() || undefined,
        unitCount: unitCount ? Number(unitCount) : undefined,
        goals: goals.trim() || undefined,
        topics: topics.trim() || undefined,
        employeeLevel: employeeLevel.trim() || undefined,
        style: style.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setSubmitted(true);
      toast.success("Course generation started.");
      router.refresh();
    });
  };

  if (submitted) {
    return (
      <div className="flex flex-col gap-y-3 rounded-2xl border-2 border-green-200 bg-green-50 p-6">
        <h3 className="text-lg font-bold text-neutral-700">
          Building your course…
        </h3>
        <p className="text-sm text-muted-foreground">
          AI is drafting the modules, lessons, and questions. This takes a
          minute. It&apos;ll appear in the{" "}
          <Link href="/studio/review" className="font-bold text-sky-600 underline">
            review queue
          </Link>{" "}
          when it&apos;s ready — review and approve it, then generate images.
        </p>
        <div>
          <Button
            type="button"
            variant="secondaryOutline"
            onClick={() => {
              setSubmitted(false);
              setIdea("");
              setTitle("");
              setUnitCount("");
              setGoals("");
              setTopics("");
              setEmployeeLevel("");
              setStyle("");
            }}
          >
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
          Describe it in plain words. The fields below are optional — fill in
          what helps.
        </p>
      </div>

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

      <div className="flex items-center justify-between gap-x-4">
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
