import { redirect } from "next/navigation";

import { startOrResumeSession } from "@/features/learning/actions/learning-loop";
import { getCourseProgress } from "@/db/queries";
import { getLessonItems, getLessonTeaching } from "@/features/courses/queries";

import { Player } from "./player";

const LessonPage = async () => {
  const courseProgress = await getCourseProgress();

  if (!courseProgress?.activeLessonId) return redirect("/learn");

  const [result, teaching, items] = await Promise.all([
    startOrResumeSession(courseProgress.activeLessonId),
    getLessonTeaching(courseProgress.activeLessonId),
    getLessonItems(courseProgress.activeLessonId),
  ]);

  if (!result.ok) return redirect("/learn");

  return (
    <Player
      sessionId={result.data.sessionId}
      lessonId={courseProgress.activeLessonId}
      initialView={result.data.view}
      teaching={teaching}
      items={items}
    />
  );
};

export default LessonPage;
