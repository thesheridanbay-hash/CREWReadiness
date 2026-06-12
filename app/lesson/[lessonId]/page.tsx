import { redirect } from "next/navigation";

import { getLesson, getUserProgress } from "@/db/queries";

import { Quiz } from "../quiz";

type LessonIdPageProps = {
  params: Promise<{
    lessonId: string;
  }>;
};

const LessonIdPage = async ({ params }: LessonIdPageProps) => {
  const { lessonId } = await params;

  const lessonData = getLesson(Number(lessonId));
  const userProgressData = getUserProgress();

  const [lesson, userProgress] = await Promise.all([
    lessonData,
    userProgressData,
  ]);

  if (!lesson || !userProgress) return redirect("/learn");

  const initialPercentage =
    (lesson.questions.filter((question) => question.completed).length /
      lesson.questions.length) *
    100;

  return (
    <Quiz
      initialLessonId={lesson.id}
      initialQuestions={lesson.questions}
      initialPercentage={initialPercentage}
    />
  );
};

export default LessonIdPage;
