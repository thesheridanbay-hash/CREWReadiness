"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { marketplaceAdoptions, marketplaceListings } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { AppActionError, fromZod, guard, ok, type Result } from "@/lib/errors";
import { materializeSnapshot } from "@/lib/marketplace/materialize-snapshot";
import { courseSnapshotSchema } from "@/lib/marketplace/snapshot";

/**
 * Marketplace actions (course marketplace). Adopting copies a public listing's
 * frozen snapshot into the caller's company as a new DRAFT course — the only
 * place marketplace content enters a tenant, and it writes ONLY into the
 * adopter's own company (scoped). The snapshot is validated as untrusted input
 * before anything is materialized.
 */

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError(
      "forbidden",
      "Only owners and managers can adopt courses."
    );
  }
  return auth;
};

const adoptSchema = z.object({ listingId: z.string().uuid() });

export const adoptListing = async (
  input: unknown
): Promise<Result<{ courseId: number; duplicate: boolean }>> =>
  guard<{ courseId: number; duplicate: boolean }>(async () => {
    const parsed = adoptSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    const outcome = await scoped<
      Result<{ courseId: number; duplicate: boolean }>
    >(auth, async (tx) => {
      // RLS only exposes PUBLISHED listings (or this company's own); a
      // non-readable id simply isn't found.
      const listing = await tx.query.marketplaceListings.findFirst({
        where: eq(marketplaceListings.id, parsed.data.listingId),
      });
      if (!listing) {
        throw new AppActionError("not_found", "Listing not found.");
      }

      // The snapshot is cross-tenant input — validate before materializing.
      const snapshot = courseSnapshotSchema.safeParse(listing.snapshot);
      if (!snapshot.success) {
        throw new AppActionError(
          "conflict",
          "This listing's content couldn't be read. The publisher may need to re-publish it."
        );
      }

      const prior = await tx.query.marketplaceAdoptions.findFirst({
        where: and(
          eq(marketplaceAdoptions.companyId, auth.companyId),
          eq(marketplaceAdoptions.listingId, listing.id)
        ),
      });

      const result = await materializeSnapshot(
        tx,
        auth.companyId,
        snapshot.data
      );

      await tx.insert(marketplaceAdoptions).values({
        companyId: auth.companyId,
        listingId: listing.id,
        adoptedCourseId: result.courseId,
        adoptedBy: auth.userId,
      });

      return ok({ courseId: result.courseId, duplicate: Boolean(prior) });
    });

    if (outcome.ok) {
      revalidatePath("/studio");
      revalidatePath("/marketplace");
    }
    return outcome;
  });
