import Link from "next/link";
import { redirect } from "next/navigation";

import { getCourseAssetStatus, type CourseAssetStatus } from "@/features/courses/actions/course-assets";
import {
  getCourseTranslationStatus,
  type CourseTranslationStatus,
} from "@/features/courses/actions/course-translate";
import { getCourseListing, type CourseListingInfo } from "@/features/marketplace/actions";
import { getSession } from "@/features/auth/session";
import {
  getAssignableTargets,
  getCourseAssignments,
} from "@/features/courses/assignment-queries";
import { getCourseTree } from "@/features/courses/queries";
import { DEFAULT_LANGUAGE } from "@/features/courses/languages";

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

  const translationResult = await getCourseTranslationStatus({
    courseId: Number(courseId),
  });
  const translationStatus: CourseTranslationStatus = translationResult.ok
    ? translationResult.data
    : { primaryLanguage: DEFAULT_LANGUAGE, totalLessons: 0, languages: [] };

  const listingResult = await getCourseListing({ courseId: Number(courseId) });
  const listing: CourseListingInfo = listingResult.ok ? listingResult.data : null;

  const [assignTargets, courseAssignments] = await Promise.all([
    getAssignableTargets(),
    getCourseAssignments(Number(courseId)),
  ]);

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
        lessons: unit.lessons.map((lesson) => {
          const audioAsset = lesson.assets.find((a) => a.kind === "AUDIO");
          return {
          id: lesson.id,
          title: lesson.title,
          teachingText: lesson.teachingText,
          images: lesson.assets
            .filter((asset) => asset.kind !== "AUDIO")
            .map((asset) => ({
              id: asset.id,
              ref: asset.ref,
              kind: asset.kind as "ICON" | "ILLUSTRATION" | "REALISTIC",
              status: asset.status,
              prompt: asset.prompt,
              // Generated art is served through the authed proxy.
              src: asset.status === "GENERATED" && asset.mediaAssetId
                ? `/api/media/${asset.mediaAssetId}`
                : null,
            })),
          // Voiceover (TTS) status for this lesson, if any.
          audio: audioAsset
            ? {
                id: audioAsset.id,
                status: audioAsset.status,
                src:
                  audioAsset.status === "GENERATED" && audioAsset.mediaAssetId
                    ? `/api/media/${audioAsset.mediaAssetId}`
                    : null,
              }
            : null,
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
          };
        }),
      })),
    })),
  };

  return (
    <div className="px-4 pb-16">
      <Link
        href="/studio"
        className="text-sm font-bold text-info hover:underline"
      >
        ← All courses
      </Link>
      <StudioEditor
        course={course}
        assetStatus={assetStatus}
        translationStatus={translationStatus}
        listing={listing}
        isPlatform={session.role === "platform"}
        assignTargets={assignTargets}
        courseAssignments={courseAssignments}
      />
    </div>
  );
};

export default CourseStudioPage;
