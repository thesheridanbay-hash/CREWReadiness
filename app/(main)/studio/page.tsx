import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import { getSession } from "@/features/auth/session";
import { getArchivedCourses, getStudioCourses } from "@/features/courses/queries";
import { Button } from "@/shared/ui/button";

import { ArchivedCourses } from "./archived-courses";
import { CourseCreator } from "./course-creator";

const StudioPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const [courses, archived] = await Promise.all([
    getStudioCourses(),
    getArchivedCourses(),
  ]);

  return (
    <div className="px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-700">Content Studio</h1>
          <p className="text-sm text-muted-foreground">
            Build the training your crew completes in the field.
          </p>
        </div>
        <Button asChild variant="primaryOutline">
          <Link href="/studio/review">Review queue</Link>
        </Button>
      </div>

      <CourseCreator />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No courses yet — create your first above.
          </p>
        )}
        {courses.map((course) => (
          <Link
            key={course.id}
            href={`/studio/${course.id}`}
            className="flex flex-col gap-y-3 rounded-2xl border-2 p-5 transition hover:bg-slate-50"
          >
            <div className="flex items-center gap-x-3">
              <Image
                src={course.imageSrc}
                alt={course.title}
                width={40}
                height={40}
                className="rounded-md border"
              />
              <span className="font-bold text-neutral-700">{course.title}</span>
            </div>
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-muted-foreground">
                {course.lessonCount} lesson{course.lessonCount === 1 ? "" : "s"}
              </span>
              <span
                className={
                  course.published
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-green-700"
                    : "rounded-full bg-amber-100 px-2 py-0.5 text-amber-700"
                }
              >
                {course.published ? "Published" : "Draft"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <ArchivedCourses courses={archived} />
    </div>
  );
};

export default StudioPage;
