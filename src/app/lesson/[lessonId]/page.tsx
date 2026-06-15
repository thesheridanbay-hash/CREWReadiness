import { redirect } from "next/navigation";

import { startOrResumeSession } from "@/features/learning/actions/learning-loop";
import { getLessonItems, getLessonTeaching } from "@/features/courses/queries";

import { Player } from "../player";

type LessonIdPageProps = {
  params: Promise<{ lessonId: string }>;
};

const LessonIdPage = async ({ params }: LessonIdPageProps) => {
  const { lessonId } = await params;
  const id = Number(lessonId);

  if (!Number.isInteger(id) || id <= 0) return redirect("/learn");

  const [result, teaching, items] = await Promise.all([
    startOrResumeSession(id),
    getLessonTeaching(id),
    getLessonItems(id),
  ]);

  if (!result.ok) return redirect("/learn");

  return (
    <Player
      sessionId={result.data.sessionId}
      lessonId={id}
      initialView={result.data.view}
      teaching={teaching}
      items={items}
    />
  );
};

export default LessonIdPage;
