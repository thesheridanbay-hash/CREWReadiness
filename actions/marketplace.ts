"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { courses, marketplaceAdoptions, marketplaceListings } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { AppActionError, err, fromZod, guard, ok, type Result } from "@/lib/errors";
import { isMarketplaceCategory } from "@/lib/marketplace/categories";
import { materializeSnapshot } from "@/lib/marketplace/materialize-snapshot";
import { serializeCourse } from "@/lib/marketplace/serialize-course";
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

/* ───────────────────────── Publishing ───────────────────────── */

const publishSchema = z.object({
  courseId: z.number().int().positive(),
  category: z.string().min(1).max(64),
  description: z.string().max(1000).default(""),
});

/**
 * Publish (or re-publish) one of the company's courses to the marketplace as a
 * COMMUNITY listing. Serializes the current course tree into a frozen snapshot
 * and flags its GENERATED media public so adopters can reference the same
 * blobs. Idempotent per course: re-publishing updates the existing listing.
 */
export const publishCourseToMarketplace = async (
  input: unknown
): Promise<Result<{ listingId: string; updated: boolean }>> =>
  guard<{ listingId: string; updated: boolean }>(async () => {
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    if (!isMarketplaceCategory(parsed.data.category)) {
      return err("validation", "Choose a valid category.");
    }

    const auth = await requireOwner();
    const { courseId, category, description } = parsed.data;

    return scoped<Result<{ listingId: string; updated: boolean }>>(
      auth,
      async (tx) => {
        const course = await tx.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });
        if (!course) throw new AppActionError("not_found", "Course not found.");

        // Validate + freeze the course (throws a friendly error if not ready).
        const snapshot = await serializeCourse(tx, courseId, {
          category,
          description,
        });

        // Flag the course's GENERATED media public so adopters can render the
        // SAME blobs (shared by reference). Scoped UPDATE: only this company's
        // course_assets/media are in range.
        await tx.execute(sql`
          UPDATE media_assets SET public = true
          WHERE id IN (
            SELECT media_asset_id FROM course_assets
            WHERE course_id = ${courseId}
              AND media_asset_id IS NOT NULL
              AND status = 'GENERATED'
          )
        `);

        const existing = await tx.query.marketplaceListings.findFirst({
          where: and(
            eq(marketplaceListings.kind, "COMMUNITY"),
            eq(marketplaceListings.sourceCompanyId, auth.companyId),
            eq(marketplaceListings.sourceCourseId, courseId)
          ),
        });

        if (existing) {
          await tx
            .update(marketplaceListings)
            .set({
              category,
              title: course.title,
              description,
              primaryLanguage: snapshot.primaryLanguage,
              snapshot,
              status: "PUBLISHED",
              updatedAt: new Date(),
            })
            .where(eq(marketplaceListings.id, existing.id));
          revalidatePath("/studio");
          revalidatePath("/marketplace");
          return ok({ listingId: existing.id, updated: true });
        }

        const [listing] = await tx
          .insert(marketplaceListings)
          .values({
            kind: "COMMUNITY",
            sourceCompanyId: auth.companyId,
            sourceCourseId: courseId,
            category,
            title: course.title,
            description,
            primaryLanguage: snapshot.primaryLanguage,
            snapshot,
            status: "PUBLISHED",
            publishedBy: auth.userId,
          })
          .returning();

        revalidatePath("/studio");
        revalidatePath("/marketplace");
        return ok({ listingId: listing.id, updated: false });
      }
    );
  });

const requirePlatform = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role !== "platform") {
    throw new AppActionError(
      "forbidden",
      "Only the platform admin can publish universal courses."
    );
  }
  return auth;
};

/**
 * Publish (or re-publish) a course as a UNIVERSAL (admin-curated) listing
 * (course marketplace, PR-5). Platform-admin only. Same serialize + flag-media
 * mechanics as community publishing, but the listing has no source company and
 * kind UNIVERSAL (RLS lets only platform write those). Idempotent per course.
 */
export const publishCourseAsUniversal = async (
  input: unknown
): Promise<Result<{ listingId: string; updated: boolean }>> =>
  guard<{ listingId: string; updated: boolean }>(async () => {
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    if (!isMarketplaceCategory(parsed.data.category)) {
      return err("validation", "Choose a valid category.");
    }

    const auth = await requirePlatform();
    const { courseId, category, description } = parsed.data;

    return scoped<Result<{ listingId: string; updated: boolean }>>(
      auth,
      async (tx) => {
        const course = await tx.query.courses.findFirst({
          where: eq(courses.id, courseId),
        });
        if (!course) throw new AppActionError("not_found", "Course not found.");

        const snapshot = await serializeCourse(tx, courseId, {
          category,
          description,
        });

        await tx.execute(sql`
          UPDATE media_assets SET public = true
          WHERE id IN (
            SELECT media_asset_id FROM course_assets
            WHERE course_id = ${courseId}
              AND media_asset_id IS NOT NULL
              AND status = 'GENERATED'
          )
        `);

        const existing = await tx.query.marketplaceListings.findFirst({
          where: and(
            eq(marketplaceListings.kind, "UNIVERSAL"),
            eq(marketplaceListings.sourceCourseId, courseId)
          ),
        });

        if (existing) {
          await tx
            .update(marketplaceListings)
            .set({
              category,
              title: course.title,
              description,
              primaryLanguage: snapshot.primaryLanguage,
              snapshot,
              status: "PUBLISHED",
              updatedAt: new Date(),
            })
            .where(eq(marketplaceListings.id, existing.id));
          revalidatePath("/studio");
          revalidatePath("/marketplace");
          return ok({ listingId: existing.id, updated: true });
        }

        const [listing] = await tx
          .insert(marketplaceListings)
          .values({
            kind: "UNIVERSAL",
            sourceCompanyId: null,
            sourceCourseId: courseId,
            category,
            title: course.title,
            description,
            primaryLanguage: snapshot.primaryLanguage,
            snapshot,
            status: "PUBLISHED",
            publishedBy: auth.userId,
          })
          .returning();

        revalidatePath("/studio");
        revalidatePath("/marketplace");
        return ok({ listingId: listing.id, updated: false });
      }
    );
  });

const listingIdSchema = z.object({ listingId: z.string().uuid() });

/** Take a listing down (owner only; RLS allows only your own COMMUNITY row).
 * Shared media stays public so existing adopters don't break (durable). */
export const unlistListing = async (
  input: unknown
): Promise<Result<{ listingId: string }>> =>
  guard<{ listingId: string }>(async () => {
    const parsed = listingIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<{ listingId: string }>>(auth, async (tx) => {
      const [row] = await tx
        .update(marketplaceListings)
        .set({ status: "UNLISTED", updatedAt: new Date() })
        .where(eq(marketplaceListings.id, parsed.data.listingId))
        .returning({ id: marketplaceListings.id });
      if (!row) throw new AppActionError("not_found", "Listing not found.");
      revalidatePath("/studio");
      revalidatePath("/marketplace");
      return ok({ listingId: row.id });
    });
  });

export type CourseListingInfo = {
  listingId: string;
  kind: "COMMUNITY" | "UNIVERSAL";
  status: "PUBLISHED" | "UNLISTED";
  category: string;
  description: string;
} | null;

/**
 * The listing for a course, if any (for the publish UI). A normal owner sees
 * their own COMMUNITY listing; the platform admin sees the course's UNIVERSAL
 * listing. (A universal listing's sourceCourseId points at the platform's own
 * course, so it never collides with another company's courseId.)
 */
export const getCourseListing = async (
  input: unknown
): Promise<Result<CourseListingInfo>> =>
  guard<CourseListingInfo>(async () => {
    const parsed = z
      .object({ courseId: z.number().int().positive() })
      .safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<CourseListingInfo>>(auth, async (tx) => {
      const listing = await tx.query.marketplaceListings.findFirst({
        where: and(
          eq(marketplaceListings.sourceCourseId, parsed.data.courseId),
          or(
            eq(marketplaceListings.sourceCompanyId, auth.companyId),
            eq(marketplaceListings.kind, "UNIVERSAL")
          )
        ),
      });
      if (!listing) return ok(null);
      return ok({
        listingId: listing.id,
        kind: listing.kind,
        status: listing.status,
        category: listing.category,
        description: listing.description,
      });
    });
  });
