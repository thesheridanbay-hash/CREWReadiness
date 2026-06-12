import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import { getSession } from "@/lib/auth/session";
import { getStudioCourses } from "@/lib/content/queries";

import { CreateCourseForm } from "./create-course-form";

const StudioPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const courses = await getStudioCourses();

  return (
    <div className="px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-700">Content Studio</h1>
          <p className="text-sm text-muted-foreground">
            Build the training your crew completes in the field.
          </p>
        </div>
        <Link
          href="/studio/review"
          className="rounded-xl border-2 px-4 py-2 text-sm font-bold text-sky-600 hover:bg-slate-50"
        >
          Review queue
        </Link>
      </div>

      <CreateCourseForm />

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
    </div>
  );
};

export default StudioPage;
