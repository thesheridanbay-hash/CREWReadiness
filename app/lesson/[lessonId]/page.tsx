import { redirect } from "next/navigation";

import { startOrResumeSession } from "@/actions/learning-loop";
import { getLessonTeaching } from "@/lib/content/queries";

import { Player } from "../player";

type LessonIdPageProps = {
  params: Promise<{ lessonId: string }>;
};

const LessonIdPage = async ({ params }: LessonIdPageProps) => {
  const { lessonId } = await params;
  const id = Number(lessonId);

  if (!Number.isInteger(id) || id <= 0) return redirect("/learn");

  const [result, teaching] = await Promise.all([
    startOrResumeSession(id),
    getLessonTeaching(id),
  ]);

  if (!result.ok) return redirect("/learn");

  return (
    <Player
      sessionId={result.data.sessionId}
      lessonId={id}
      initialView={result.data.view}
      teaching={teaching}
    />
  );
};

export default LessonIdPage;
