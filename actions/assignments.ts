"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  assignments,
  courses,
  crews,
  employeeCredentials,
} from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { AppActionError, fromZod, guard, ok, type Result } from "@/shared/errors";

/**
 * Assignment actions (go-live A1). Owners/managers assign a course to a crew OR
 * an individual (exactly one target) with an optional due date + required flag.
 * Idempotent per (course, target): re-assigning updates the due date/required
 * rather than duplicating.
 */

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError(
      "forbidden",
      "Only owners and managers can assign training."
    );
  }
  return auth;
};

const assignSchema = z
  .object({
    courseId: z.number().int().positive(),
    crewId: z.number().int().positive().optional(),
    userId: z.string().min(1).optional(),
    dueDate: z.coerce.date().nullable().optional(),
    required: z.boolean().default(true),
  })
  .refine((v) => (v.crewId === undefined) !== (v.userId === undefined), {
    message: "Assign to exactly one crew or one member.",
  });

export const assignCourse = async (
  input: unknown
): Promise<Result<{ assignmentId: number; updated: boolean }>> =>
  guard<{ assignmentId: number; updated: boolean }>(async () => {
    const parsed = assignSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();
    const { courseId, crewId, userId, dueDate, required } = parsed.data;

    return scoped<Result<{ assignmentId: number; updated: boolean }>>(
      auth,
      async (tx) => {
        const course = await tx.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });
        if (!course) throw new AppActionError("not_found", "Course not found.");

        // Validate the target belongs to this company.
        if (crewId !== undefined) {
          const crew = await tx.query.crews.findFirst({
            where: eq(crews.id, crewId),
          });
          if (!crew) throw new AppActionError("not_found", "Crew not found.");
        } else {
          const member = await tx.query.employeeCredentials.findFirst({
            where: and(
              eq(employeeCredentials.companyId, auth.companyId),
              eq(employeeCredentials.userId, userId!)
            ),
          });
          if (!member) {
            throw new AppActionError("not_found", "Employee not found.");
          }
        }

        // Idempotent per (course, target): update an existing assignment.
        const existing = await tx.query.assignments.findFirst({
          where: and(
            eq(assignments.courseId, courseId),
            crewId !== undefined
              ? eq(assignments.crewId, crewId)
              : eq(assignments.userId, userId!),
            crewId !== undefined
              ? isNull(assignments.userId)
              : isNull(assignments.crewId)
          ),
        });

        if (existing) {
          await tx
            .update(assignments)
            .set({ dueDate: dueDate ?? null, required })
            .where(eq(assignments.id, existing.id));
          revalidatePath(`/studio/${courseId}`);
          revalidatePath("/courses");
          return ok({ assignmentId: existing.id, updated: true });
        }

        const [row] = await tx
          .insert(assignments)
          .values({
            companyId: auth.companyId,
            courseId,
            crewId: crewId ?? null,
            userId: userId ?? null,
            assignedBy: auth.userId,
            dueDate: dueDate ?? null,
            required,
          })
          .returning();

        revalidatePath(`/studio/${courseId}`);
        revalidatePath("/courses");
        return ok({ assignmentId: row.id, updated: false });
      }
    );
  });

const unassignSchema = z.object({ assignmentId: z.number().int().positive() });

export const unassignCourse = async (
  input: unknown
): Promise<Result<{ removed: boolean }>> =>
  guard<{ removed: boolean }>(async () => {
    const parsed = unassignSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<{ removed: boolean }>>(auth, async (tx) => {
      const [row] = await tx
        .delete(assignments)
        .where(eq(assignments.id, parsed.data.assignmentId))
        .returning({ id: assignments.id });
      if (!row) throw new AppActionError("not_found", "Assignment not found.");
      revalidatePath("/courses");
      return ok({ removed: true });
    });
  });
