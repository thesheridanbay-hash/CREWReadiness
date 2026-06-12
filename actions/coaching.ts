"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parkedConcepts } from "@/db/schema";
import { AppActionError, fromZod, guard, ok, type Result } from "@/lib/errors";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Coaching actions (T12 — D23). A manager marks a parked concept "coached"
 * after working it with the employee in person; it leaves the queue. The
 * employee can then re-attempt the question (completion is still derived from
 * a correct attempt, so the lesson only finishes once they actually pass).
 */

const resolveSchema = z.object({ id: z.number().int().positive() });

export const resolveParkedConcept = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = resolveSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await getSession();
    if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
    if (auth.role === "employee") {
      throw new AppActionError("forbidden", "Only managers can resolve coaching items.");
    }

    return scoped<Result<null>>(auth, async (tx) => {
      const concept = await tx.query.parkedConcepts.findFirst({
        where: eq(parkedConcepts.id, parsed.data.id),
      });
      if (!concept) throw new AppActionError("not_found", "Coaching item not found.");

      await tx
        .update(parkedConcepts)
        .set({
          status: "RESOLVED",
          resolvedBy: auth.userId,
          resolvedAt: new Date(),
        })
        .where(eq(parkedConcepts.id, parsed.data.id));

      revalidatePath("/coaching");
      return ok(null);
    });
  });
