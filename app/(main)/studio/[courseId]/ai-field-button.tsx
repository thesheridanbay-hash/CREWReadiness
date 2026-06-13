"use client";

import { useState, useTransition } from "react";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { improveField } from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";

type Field =
  | "lessonTeaching"
  | "lessonTitle"
  | "questionPrompt"
  | "explanation"
  | "option";

/**
 * AI-magic field editor (course studio). A small ✨ button next to any text
 * field that opens a popup: click Improve to auto-polish, or type an
 * instruction ("make it bullets", "simpler words"). Calls improveField, which
 * rewrites + persists that one field, then surfaces the new text.
 */
export const AiFieldButton = ({
  field,
  id,
  label,
  suggestions,
  onApplied,
}: {
  field: Field;
  id: number;
  label: string;
  suggestions?: string[];
  onApplied?: (text: string) => void;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();

  const apply = () =>
    startTransition(async () => {
      const result = await improveField({
        field,
        id,
        instruction: instruction.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Updated with AI.");
      onApplied?.(result.data.text);
      setInstruction("");
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        title={`Improve ${label} with AI`}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold text-sky-600 hover:bg-sky-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border-2 bg-white p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-bold text-neutral-700">
              Improve {label} with AI
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Hit Improve to auto-polish, or tell the AI exactly what you want.
            </p>
            <textarea
              value={instruction}
              maxLength={1000}
              disabled={pending}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="e.g. make it bullet points · simpler words · shorter · add a common mistake"
              className="mt-3 min-h-20 w-full rounded-xl border-2 px-3 py-2 text-sm outline-none focus:border-green-500"
            />
            {suggestions && suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={pending}
                    onClick={() => setInstruction(suggestion)}
                    className="rounded-full border-2 px-2 py-0.5 text-xs font-medium text-neutral-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="default" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="secondary" disabled={pending} onClick={apply}>
                {pending ? "Working…" : "Improve"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
