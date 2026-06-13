import { getMyAssignments } from "@/lib/content/assignment-queries";
import { getCourses, getUserProgress } from "@/db/queries";

import { List } from "./list";

const CoursesPage = async () => {
  const coursesData = getCourses();
  const userProgressData = getUserProgress();
  const assignmentsData = getMyAssignments();

  const [courses, userProgress, assignments] = await Promise.all([
    coursesData,
    userProgressData,
    assignmentsData,
  ]);

  return (
    <div className="mx-auto h-full max-w-[912px] px-3">
      <h1 className="text-2xl font-bold text-neutral-700">Training Courses</h1>

      <List
        courses={courses}
        activeCourseId={userProgress?.activeCourseId}
        assignments={assignments}
      />
    </div>
  );
};

export default CoursesPage;
