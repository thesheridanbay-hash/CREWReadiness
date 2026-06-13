"use client";

import { useState } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteCourse, restoreCourse } from "@/actions/content";
import { Button } from "@/shared/ui/button";
import type { ArchivedCourse } from "@/lib/content/queries";

/**
 * Archived courses (course lifecycle): restore back to active, or permanently
 * delete (archive-first is enforced server-side).
 */
export const ArchivedCourses = ({ courses }: { courses: ArchivedCourse[] }) => {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  if (courses.length === 0) return null;

  const restore = (id: number) => {
    if (busyId) return;
    setBusyId(id);
    restoreCourse({ courseId: id })
      .then((result) => {
        if (!result.ok) toast.error(result.error.message);
        else {
          toast.success("Course restored.");
          router.refresh();
        }
      })
      .catch(() => toast.error("Something went wrong."))
      .finally(() => setBusyId(null));
  };

  const remove = (id: number, title: string) => {
    if (busyId) return;
    if (
      !window.confirm(
        `Permanently delete "${title}"? This removes its lessons, questions, media, and assignments and can't be undone.`
      )
    )
      return;
    setBusyId(id);
    deleteCourse({ courseId: id })
      .then((result) => {
        if (!result.ok) toast.error(result.error.message);
        else {
          toast.success("Course deleted.");
          router.refresh();
        }
      })
      .catch(() => toast.error("Something went wrong."))
      .finally(() => setBusyId(null));
  };

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Archived
      </h2>
      <div className="flex flex-col gap-y-2">
        {courses.map((course) => (
          <div
            key={course.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 p-3"
          >
            <div className="flex items-center gap-x-3">
              <Image
                src={course.imageSrc}
                alt={course.title}
                width={32}
                height={32}
                className="rounded-md border opacity-70"
              />
              <span className="font-medium text-neutral-600">
                {course.title}
              </span>
            </div>
            <div className="flex items-center gap-x-2">
              <Button
                variant="primaryOutline"
                disabled={busyId !== null}
                onClick={() => restore(course.id)}
              >
                {busyId === course.id ? "…" : "Restore"}
              </Button>
              <Button
                variant="dangerOutline"
                disabled={busyId !== null}
                onClick={() => remove(course.id, course.title)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
