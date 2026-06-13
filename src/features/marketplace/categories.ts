/**
 * Marketplace categories (course marketplace). Like SUPPORTED_LANGUAGES, this
 * is the single seam: adding a `{ slug, label }` teaches the whole system a new
 * category. Stored as plain text on the listing (no enum) so a new category
 * needs no DDL — validated against this list. Extensible later to an
 * admin-managed table without changing the column.
 */
export const MARKETPLACE_CATEGORIES = [
  { slug: "safety", label: "Safety" },
  { slug: "equipment", label: "Equipment" },
  { slug: "customer-service", label: "Customer Service" },
  { slug: "compliance", label: "Compliance" },
  { slug: "onboarding", label: "Onboarding" },
  { slug: "general", label: "General" },
] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number]["slug"];

export const MARKETPLACE_CATEGORY_SLUGS: readonly string[] =
  MARKETPLACE_CATEGORIES.map((category) => category.slug);

export const isMarketplaceCategory = (slug: string): slug is MarketplaceCategory =>
  MARKETPLACE_CATEGORY_SLUGS.includes(slug);

/** Human label for a category slug; falls back to the raw slug if unknown. */
export const categoryLabel = (slug: string): string =>
  MARKETPLACE_CATEGORIES.find((category) => category.slug === slug)?.label ??
  slug;
