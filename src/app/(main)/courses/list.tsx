"use client";

import { useTransition } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { upsertUserProgress } from "@/features/learning/actions/user-progress";
import { courses as coursesTable, userProgress } from "@/db/schema";
import type { MyAssignment } from "@/features/courses/assignment-queries";

import { Card } from "./card";

type ListProps = {
  courses: (typeof coursesTable.$inferSelect)[];
  activeCourseId?: typeof userProgress.$inferSelect.activeCourseId;
  assignments: MyAssignment[];
};

export const List = ({ courses, activeCourseId, assignments }: ListProps) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = (id: number) => {
    if (pending) return;
    if (id === activeCourseId) return router.push("/learn");

    startTransition(() => {
      upsertUserProgress(id)
        .then((result) => {
          if (result && !result.ok) toast.error(result.error.message);
        })
        .catch(() => toast.error("Something went wrong."));
    });
  };

  return (
    <>
      {assignments.length > 0 && (
        <section className="pt-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Assigned to you
          </h2>
          <div className="flex flex-col gap-y-2">
            {assignments.map((assignment) => (
              <button
                key={assignment.assignmentId}
                type="button"
                disabled={pending}
                onClick={() => onClick(assignment.courseId)}
                className="flex items-center justify-between gap-x-3 rounded-2xl border-2 p-4 text-left transition hover:bg-canvas-2 disabled:opacity-60"
              >
                <div className="flex items-center gap-x-3">
                  <Image
                    src={assignment.imageSrc}
                    alt={assignment.title}
                    width={40}
                    height={40}
                    className="rounded-md border"
                  />
                  <div>
                    <div className="font-bold text-ink">
                      {assignment.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {assignment.done}/{assignment.total} done
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-x-2">
                  {assignment.required && (
                    <span className="rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold text-gold-700">
                      Required
                    </span>
                  )}
                  {assignment.completed ? (
                    <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-700">
                      ✓ Done
                    </span>
                  ) : assignment.overdue ? (
                    <span className="rounded-full bg-danger-50 px-2 py-0.5 text-xs font-bold text-danger">
                      Overdue
                    </span>
                  ) : assignment.dueDate ? (
                    <span className="rounded-full bg-canvas-2 px-2 py-0.5 text-xs font-bold text-ink-3">
                      Due {assignment.dueDate.toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        {assignments.length > 0 && (
          <h2 className="mb-1 mt-8 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            All courses
          </h2>
        )}
        <div className="grid grid-cols-2 gap-4 pt-6 lg:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {courses.map((course) => (
            <Card
              key={course.id}
              id={course.id}
              title={course.title}
              imageSrc={course.imageSrc}
              onClick={onClick}
              disabled={pending}
              isActive={course.id === activeCourseId}
            />
          ))}
        </div>
      </section>
    </>
  );
};
