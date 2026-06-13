import Link from "next/link";
import { redirect } from "next/navigation";

import { getCourseAssetStatus, type CourseAssetStatus } from "@/actions/course-assets";
import { getSession } from "@/lib/auth/session";
import { getCourseTree } from "@/lib/content/queries";

import { StudioEditor, type EditorCourse } from "./studio-editor";

type PageProps = {
  params: Promise<{ courseId: string }>;
};

const CourseStudioPage = async ({ params }: PageProps) => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const { courseId } = await params;
  const tree = await getCourseTree(Number(courseId));

  if (!tree) redirect("/studio");

  const statusResult = await getCourseAssetStatus({ courseId: Number(courseId) });
  const assetStatus: CourseAssetStatus = statusResult.ok
    ? statusResult.data
    : { total: 0, pending: 0, generated: 0, failed: 0 };

  const course: EditorCourse = {
    id: tree.id,
    title: tree.title,
    published: tree.activeContentVersionId !== null,
    modules: tree.modules.map((module) => ({
      id: module.id,
      title: module.title,
      units: module.units.map((unit) => ({
        id: unit.id,
        title: unit.title,
        lessons: unit.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          teachingText: lesson.teachingText,
          images: lesson.assets.map((asset) => ({
            id: asset.id,
            ref: asset.ref,
            kind: asset.kind,
            status: asset.status,
            // Generated art is served through the authed proxy.
            src: asset.status === "GENERATED" && asset.mediaAssetId
              ? `/api/media/${asset.mediaAssetId}`
              : null,
          })),
          questions: lesson.questions.map((question) => ({
            id: question.id,
            question: question.question,
            type: question.type,
            explanation: question.explanation,
            options: question.questionOptions.map((option) => ({
              id: option.id,
              text: option.text,
              correct: option.correct,
            })),
          })),
        })),
      })),
    })),
  };

  return (
    <div className="px-4 pb-16">
      <Link
        href="/studio"
        className="text-sm font-bold text-sky-600 hover:underline"
      >
        ← All courses
      </Link>
      <StudioEditor course={course} assetStatus={assetStatus} />
    </div>
  );
};

export default CourseStudioPage;
