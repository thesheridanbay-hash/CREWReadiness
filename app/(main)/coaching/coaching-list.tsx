"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { resolveParkedConcept } from "@/features/coaching/actions";
import { Button } from "@/shared/ui/button";
import type { ParkedItem } from "@/lib/content/coaching-queries";

export const CoachingList = ({ items }: { items: ParkedItem[] }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const resolve = (id: number) =>
    startTransition(async () => {
      const result = await resolveParkedConcept({ id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Marked coached — back to the crew member to retry.");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start justify-between gap-x-4 rounded-2xl border-2 p-4"
        >
          <div>
            <div className="flex items-center gap-x-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                {item.employeeName}
              </span>
              <span className="text-xs text-muted-foreground">
                {item.lessonTitle}
              </span>
            </div>
            <p className="mt-2 font-medium text-neutral-700">
              {item.questionText}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => resolve(item.id)}
          >
            Mark coached
          </Button>
        </div>
      ))}
    </div>
  );
};
