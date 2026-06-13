"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateLesson } from "@/actions/content";
import { Button } from "@/shared/ui/button";

import { AiFieldButton } from "./ai-field-button";

/**
 * Editable lesson teaching text (course studio). Plain Markdown textarea +
 * Save, with the ✨ AI button to rewrite/format the field. Replaces the old
 * read-only display so owners can edit teaching content (and reformat the
 * existing wall-of-text into markdown with one click).
 */
export const LessonTeachingEditor = ({
  lessonId,
  initial,
}: {
  lessonId: number;
  initial: string;
}) => {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty = text !== initial;

  const save = () =>
    startTransition(async () => {
      const result = await updateLesson({ lessonId, teachingText: text });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Teaching text saved.");
      router.refresh();
    });

  return (
    <div className="ml-2 mt-2">
      <div className="flex items-center justify-between gap-x-2">
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
          Teaching (markdown)
        </p>
        <AiFieldButton
          field="lessonTeaching"
          id={lessonId}
          label="teaching text"
          suggestions={[
            "Make it bullet points",
            "Simpler words",
            "Shorter",
            "Add a common mistake",
          ]}
          onApplied={(value) => setText(value)}
        />
      </div>
      <textarea
        value={text}
        disabled={pending}
        onChange={(event) => setText(event.target.value)}
        placeholder="Plain-language teaching text. Use **bold** and - bullets, or tap AI to format it."
        className="mt-1 min-h-24 w-full rounded-lg border-2 px-3 py-2 text-xs leading-relaxed text-neutral-600 outline-none focus:border-green-500"
      />
      {dirty && (
        <div className="mt-1">
          <Button variant="secondary" size="sm" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
};
