import { redirect } from "next/navigation";

import { LanguageSwitcher } from "@/app-shell/language-switcher";
import { getViewerLanguagePreference } from "@/features/courses/translations";
import {
  getCourseProgress,
  getLessonPercentage,
  getUnits,
  getUserProgress,
} from "@/db/queries";

import { Header } from "./header";
import { Unit } from "./unit";

const LearnPage = async () => {
  const userProgressData = getUserProgress();
  const courseProgressData = getCourseProgress();
  const lessonPercentageData = getLessonPercentage();
  const unitsData = getUnits();

  const languageData = getViewerLanguagePreference();

  const [userProgress, units, courseProgress, lessonPercentage, language] =
    await Promise.all([
      userProgressData,
      unitsData,
      courseProgressData,
      lessonPercentageData,
      languageData,
    ]);

  if (!courseProgress || !userProgress || !userProgress.activeCourse)
    redirect("/courses");

  // De-gamified (B2B): no points counter / leaderboard sticky column, so the
  // lesson column centers and the header spans the full width.
  return (
    <>
      <Header
        title={userProgress.activeCourse.title}
        right={
          <LanguageSwitcher
            compact
            current={language.language}
            primary={language.primary}
          />
        }
      />
      <div className="mx-auto max-w-3xl px-6 pb-10">
        {units.map((unit) => (
          <div key={unit.id} className="mb-10">
            <Unit
              id={unit.id}
              order={unit.order}
              description={unit.description}
              title={unit.title}
              lessons={unit.lessons}
              activeLesson={courseProgress.activeLesson}
              activeLessonPercentage={lessonPercentage}
            />
          </div>
        ))}
      </div>
    </>
  );
};

export default LearnPage;
