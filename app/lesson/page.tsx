import { redirect } from "next/navigation";

import { getLesson, getUserProgress } from "@/db/queries";

import { Quiz } from "./quiz";

const LessonPage = async () => {
  const lessonData = getLesson();
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

export default LessonPage;
