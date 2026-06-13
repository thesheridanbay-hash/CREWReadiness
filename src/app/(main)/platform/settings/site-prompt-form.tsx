"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { upsertCourseBuilderSitePrompt } from "@/features/platform/actions";
import { Button } from "@/shared/ui/button";

/**
 * Platform-wide "master prompt" for the AI Course Builder. Applies to every
 * company's course generation; each company layers its own guidance on top
 * (company_settings.masterPrompt). Trusted instruction — set here by the
 * platform owner, composed with the company prompt at generation time.
 */
export const SitePromptForm = ({ current }: { current: { sitePrompt: string } }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sitePrompt, setSitePrompt] = useState(current.sitePrompt);

  const submit = () => {
    startTransition(async () => {
      const result = await upsertCourseBuilderSitePrompt({ sitePrompt });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Course-builder prompt saved.");
      router.refresh();
    });
  };

  return (
    <form
      className="flex max-w-xl flex-col gap-y-4 rounded-2xl border-2 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">
          Site course-builder guidance{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          className="min-h-32 w-full rounded-xl border-2 px-4 py-2 outline-none focus:border-green-500"
          placeholder="House style for every generated course: plain 6th-grade language, real job-site scenarios, one concept per lesson…"
          value={sitePrompt}
          onChange={(event) => setSitePrompt(event.target.value)}
          maxLength={4000}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Applies to all companies. Each company can add its own guidance on top.
        </p>
      </div>

      <Button type="submit" variant="secondary" size="lg" disabled={pending}>
        Save guidance
      </Button>
    </form>
  );
};
