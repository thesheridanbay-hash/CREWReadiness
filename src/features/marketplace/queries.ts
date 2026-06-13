import { and, desc, eq, ilike, or } from "drizzle-orm";

import { marketplaceAdoptions, marketplaceListings } from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";

import { courseSnapshotSchema, snapshotStats, type SnapshotStats } from "./snapshot";

/**
 * Marketplace browse reads (course marketplace, PR-4). Owner-facing. RLS makes
 * PUBLISHED listings readable to any company; we additionally filter to
 * PUBLISHED here so the catalog never shows another company's unlisted rows.
 */

export type MarketplaceCard = {
  id: string;
  kind: "COMMUNITY" | "UNIVERSAL";
  title: string;
  description: string;
  category: string;
  primaryLanguage: string;
  /** This company published it (shown in the catalog as "Yours"). */
  mine: boolean;
  publishedAt: Date;
};

export const getMarketplaceListings = async (opts: {
  category?: string;
  q?: string;
}): Promise<MarketplaceCard[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  return scoped(session, async (tx) => {
    const conditions = [eq(marketplaceListings.status, "PUBLISHED")];
    if (opts.category) {
      conditions.push(eq(marketplaceListings.category, opts.category));
    }
    const term = opts.q?.trim();
    if (term) {
      const like = `%${term}%`;
      const match = or(
        ilike(marketplaceListings.title, like),
        ilike(marketplaceListings.description, like)
      );
      if (match) conditions.push(match);
    }

    const rows = await tx.query.marketplaceListings.findMany({
      where: and(...conditions),
      orderBy: [desc(marketplaceListings.publishedAt)],
      limit: 60,
    });

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      category: row.category,
      primaryLanguage: row.primaryLanguage,
      mine: row.sourceCompanyId === session.companyId,
      publishedAt: row.publishedAt,
    }));
  });
};

export type ListingOutline = Array<{
  module: string;
  units: Array<{ title: string; lessons: string[] }>;
}>;

export type ListingDetail = {
  id: string;
  kind: "COMMUNITY" | "UNIVERSAL";
  title: string;
  description: string;
  category: string;
  primaryLanguage: string;
  status: "PUBLISHED" | "UNLISTED";
  mine: boolean;
  stats: SnapshotStats | null;
  outline: ListingOutline;
  alreadyAdopted: boolean;
};

export const getListingDetail = async (
  listingId: string
): Promise<ListingDetail | null> => {
  const session = await getSession();
  if (!session || session.role === "employee") return null;

  return scoped(session, async (tx) => {
    const listing = await tx.query.marketplaceListings.findFirst({
      where: eq(marketplaceListings.id, listingId),
    });
    if (!listing) return null;

    const parsed = courseSnapshotSchema.safeParse(listing.snapshot);
    const stats = parsed.success ? snapshotStats(parsed.data) : null;
    const outline: ListingOutline = parsed.success
      ? parsed.data.modules.map((mod) => ({
          module: mod.title,
          units: mod.units.map((unit) => ({
            title: unit.title,
            lessons: unit.lessons.map((lesson) => lesson.title),
          })),
        }))
      : [];

    const prior = await tx.query.marketplaceAdoptions.findFirst({
      where: and(
        eq(marketplaceAdoptions.companyId, session.companyId),
        eq(marketplaceAdoptions.listingId, listing.id)
      ),
    });

    return {
      id: listing.id,
      kind: listing.kind,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      primaryLanguage: listing.primaryLanguage,
      status: listing.status,
      mine: listing.sourceCompanyId === session.companyId,
      stats,
      outline,
      alreadyAdopted: Boolean(prior),
    };
  });
};
