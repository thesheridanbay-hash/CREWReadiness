import { redirect } from "next/navigation";

import { FeedWrapper } from "@/shared/components/feed-wrapper";
import { LanguageSwitcher } from "@/app-shell/language-switcher";
import { Quests } from "@/features/learning/ui/quests";
import { StickyWrapper } from "@/shared/components/sticky-wrapper";
import { UserProgress } from "@/features/learning/ui/user-progress";
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

  return (
    <div className="flex flex-row-reverse gap-[48px] px-6">
      <StickyWrapper>
        <UserProgress
          activeCourse={userProgress.activeCourse}
          points={userProgress.points}
        />

        <Quests points={userProgress.points} />
      </StickyWrapper>
      <FeedWrapper>
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
      </FeedWrapper>
    </div>
  );
};

export default LearnPage;
