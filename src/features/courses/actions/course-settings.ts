"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { companySettings } from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";
import { AppActionError, fromZod, guard, ok, type Result } from "@/shared/errors";

/**
 * Per-company "master prompt" for the AI Course Builder. Owner/manager-set
 * guidance (the company's voice, priorities, terminology) that layers on top
 * of the platform site prompt at generation time (lib/ai/prompt-composer).
 * Tenant-scoped: company_settings is RLS'd, so a session only ever sees and
 * writes its own row.
 */

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError(
      "forbidden",
      "Only owners and managers can change course settings."
    );
  }
  return auth;
};

export const getCompanyMasterPrompt = async (): Promise<Result<{ masterPrompt: string }>> =>
  guard<{ masterPrompt: string }>(async () => {
    const auth = await requireOwner();

    return scoped<Result<{ masterPrompt: string }>>(auth, async (tx) => {
      const row = await tx.query.companySettings.findFirst();
      return ok({ masterPrompt: row?.masterPrompt ?? "" });
    });
  });

const masterPromptSchema = z.object({
  masterPrompt: z.string().trim().max(4000),
});

export const setCompanyMasterPrompt = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = masterPromptSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();
    const masterPrompt = parsed.data.masterPrompt || null;

    return scoped<Result<null>>(auth, async (tx) => {
      const existing = await tx.query.companySettings.findFirst({
        where: eq(companySettings.companyId, auth.companyId),
      });
      if (existing) {
        await tx
          .update(companySettings)
          .set({ masterPrompt, updatedBy: auth.userId, updatedAt: new Date() })
          .where(eq(companySettings.companyId, auth.companyId));
      } else {
        await tx.insert(companySettings).values({
          companyId: auth.companyId,
          masterPrompt,
          updatedBy: auth.userId,
        });
      }

      revalidatePath("/studio");
      return ok(null);
    });
  });
