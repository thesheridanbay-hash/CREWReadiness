import { redirect } from "next/navigation";

import { startOrResumeSession } from "@/actions/learning-loop";
import { getCourseProgress } from "@/db/queries";

import { Player } from "./player";

const LessonPage = async () => {
  const courseProgress = await getCourseProgress();

  if (!courseProgress?.activeLessonId) return redirect("/learn");

  const result = await startOrResumeSession(courseProgress.activeLessonId);

  if (!result.ok) return redirect("/learn");

  return (
    <Player
      sessionId={result.data.sessionId}
      lessonId={courseProgress.activeLessonId}
      initialView={result.data.view}
    />
  );
};

export default LessonPage;
