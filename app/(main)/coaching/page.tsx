import { redirect } from "next/navigation";

import { getSession } from "@/features/auth/session";
import { getParkedConcepts } from "@/features/courses/coaching-queries";

import { CoachingList } from "./coaching-list";

const CoachingPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const items = await getParkedConcepts();

  return (
    <div className="px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-700">Coaching queue</h1>
        <p className="text-sm text-muted-foreground">
          Concepts a crew member couldn&apos;t get through on their own. Coach
          them in person, then mark it done — they&apos;ll retry the question.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing parked right now. When someone gets stuck after a few tries,
          it shows up here.
        </div>
      ) : (
        <CoachingList items={items} />
      )}
    </div>
  );
};

export default CoachingPage;
