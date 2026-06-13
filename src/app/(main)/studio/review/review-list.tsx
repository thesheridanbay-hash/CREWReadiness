"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { approveReviewItem, rejectReviewItem } from "@/features/courses/actions/review";
import { Button } from "@/shared/ui/button";
import type { ReviewItem } from "@/features/courses/review-queries";

export const ReviewList = ({ items }: { items: ReviewItem[] }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const act = (
    fn: typeof approveReviewItem,
    id: number,
    success: string
  ) =>
    startTransition(async () => {
      const result = await fn({ id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-x-4 rounded-2xl border-2 p-4"
        >
          <div>
            <div className="flex items-center gap-x-2">
              <p className="font-bold text-neutral-700">{item.title}</p>
              {item.kind === "course" && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                  AI course
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {item.lessonCount} lesson{item.lessonCount === 1 ? "" : "s"} ·{" "}
              {item.questionCount} question{item.questionCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              variant="default"
              disabled={pending}
              onClick={() => act(rejectReviewItem, item.id, "Draft rejected.")}
            >
              Reject
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                act(approveReviewItem, item.id, "Approved — find it in Studio to publish.")
              }
            >
              Approve
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
