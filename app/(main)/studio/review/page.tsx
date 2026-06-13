import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import {
  getCourseGenerationAttempts,
  getReviewQueue,
} from "@/lib/content/review-queries";

import { GenerationAttempts } from "./generation-attempts";
import { ReviewList } from "./review-list";

const ReviewPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const [items, attempts] = await Promise.all([
    getReviewQueue(),
    getCourseGenerationAttempts(),
  ]);

  return (
    <div className="px-4">
      <Link href="/studio" className="text-sm font-bold text-sky-600 hover:underline">
        ← Studio
      </Link>
      <div className="my-4">
        <h1 className="text-2xl font-bold text-neutral-700">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          AI-drafted training waits here. Nothing reaches your crew until you
          approve it.
        </p>
      </div>

      <GenerationAttempts attempts={attempts} />

      {items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
          No drafts to review. When you turn notes, voice, or photos into
          training, the AI drafts land here first.
        </div>
      ) : (
        <ReviewList items={items} />
      )}
    </div>
  );
};

export default ReviewPage;
