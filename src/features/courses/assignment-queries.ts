import { cache } from "react";

import { asc, eq, sql } from "drizzle-orm";

import { crews, employeeCredentials } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/shared/db/scoped";

/**
 * Assignment reads (go-live A1). Owners assign courses to crews/members with a
 * due date + required flag; learners see what's assigned to them. Everything is
 * scoped (RLS confines to the company).
 */

export type MyAssignment = {
  assignmentId: number;
  courseId: number;
  title: string;
  imageSrc: string;
  required: boolean;
  dueDate: Date | null;
  total: number;
  done: number;
  completed: boolean;
  overdue: boolean;
};

/**
 * Courses assigned to the current user — directly OR via a crew they're in —
 * with computed completion (correct-answer coverage) and overdue flag.
 * De-duplicated per course (keep required + earliest due).
 */
export const getMyAssignments = cache(async (): Promise<MyAssignment[]> => {
  const session = await getSession();
  if (!session) return [];

  const rows = await scoped(session, (tx) =>
    tx.execute<{
      assignment_id: number;
      course_id: number;
      title: string;
      image_src: string;
      required: boolean;
      due_date: string | null;
      total: number;
      done: number;
    }>(sql`
      SELECT a.id AS assignment_id, a.course_id, c.title, c.image_src,
             a.required, a.due_date,
             (SELECT count(*)::int FROM questions q
                JOIN lessons l ON l.id = q.lesson_id
                JOIN units u ON u.id = l.unit_id
                JOIN modules m ON m.id = u.module_id
                WHERE m.course_id = a.course_id) AS total,
             (SELECT count(DISTINCT q.id)::int FROM questions q
                JOIN lessons l ON l.id = q.lesson_id
                JOIN units u ON u.id = l.unit_id
                JOIN modules m ON m.id = u.module_id
                WHERE m.course_id = a.course_id
                  AND EXISTS (
                    SELECT 1 FROM attempts at
                    WHERE at.question_id = q.id
                      AND at.user_id = ${session.userId}
                      AND at.correct
                  )) AS done
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      WHERE c.archived_at IS NULL
        AND (
          a.user_id = ${session.userId}
          OR a.crew_id IN (
               SELECT crew_id FROM crew_members WHERE user_id = ${session.userId}
             )
        )
      ORDER BY a.required DESC, a.due_date ASC NULLS LAST, c.title
    `)
  );

  const now = Date.now();
  const byCourse = new Map<number, MyAssignment>();
  for (const row of rows.rows) {
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    const completed = row.total > 0 && row.done >= row.total;
    const assignment: MyAssignment = {
      assignmentId: row.assignment_id,
      courseId: row.course_id,
      title: row.title,
      imageSrc: row.image_src,
      required: row.required,
      dueDate,
      total: row.total,
      done: row.done,
      completed,
      overdue: Boolean(dueDate && !completed && dueDate.getTime() < now),
    };
    // First row per course wins (already ordered required-first, soonest due).
    if (!byCourse.has(row.course_id)) byCourse.set(row.course_id, assignment);
  }
  return [...byCourse.values()];
});

export type CourseAssignmentRow = {
  assignmentId: number;
  targetKind: "crew" | "user";
  targetLabel: string;
  required: boolean;
  dueDate: Date | null;
};

/** Who a course is assigned to (owner view), with friendly target labels. */
export const getCourseAssignments = cache(
  async (courseId: number): Promise<CourseAssignmentRow[]> => {
    const session = await getSession();
    if (!session || session.role === "employee") return [];

    const rows = await scoped(session, (tx) =>
      tx.execute<{
        assignment_id: number;
        crew_id: number | null;
        user_id: string | null;
        crew_name: string | null;
        display_name: string | null;
        required: boolean;
        due_date: string | null;
      }>(sql`
        SELECT a.id AS assignment_id, a.crew_id, a.user_id,
               cr.name AS crew_name, ec.display_name, a.required, a.due_date
        FROM assignments a
        LEFT JOIN crews cr ON cr.id = a.crew_id
        LEFT JOIN employee_credentials ec ON ec.user_id = a.user_id
        WHERE a.course_id = ${courseId}
        ORDER BY a.created_at DESC
      `)
    );

    return rows.rows.map((row) => ({
      assignmentId: row.assignment_id,
      targetKind: row.crew_id !== null ? ("crew" as const) : ("user" as const),
      targetLabel:
        row.crew_id !== null
          ? `${row.crew_name ?? "Crew"} (crew)`
          : (row.display_name ?? "Employee"),
      required: row.required,
      dueDate: row.due_date ? new Date(row.due_date) : null,
    }));
  }
);

export type AssignTargets = {
  crews: Array<{ id: number; name: string }>;
  members: Array<{ userId: string; displayName: string }>;
};

/** Crews + members available to assign to (owner picker). */
export const getAssignableTargets = cache(async (): Promise<AssignTargets> => {
  const session = await getSession();
  if (!session || session.role === "employee") {
    return { crews: [], members: [] };
  }

  return scoped(session, async (tx) => {
    const crewRows = await tx.query.crews.findMany({
      orderBy: [asc(crews.name)],
      columns: { id: true, name: true },
    });
    const memberRows = await tx.query.employeeCredentials.findMany({
      where: eq(employeeCredentials.companyId, session.companyId),
      orderBy: [asc(employeeCredentials.displayName)],
      columns: { userId: true, displayName: true },
    });
    return {
      crews: crewRows,
      members: memberRows.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
      })),
    };
  });
});
