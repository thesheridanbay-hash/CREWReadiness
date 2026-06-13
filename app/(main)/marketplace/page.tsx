import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { languageLabel } from "@/features/courses/languages";
import {
  MARKETPLACE_CATEGORIES,
  categoryLabel,
} from "@/features/marketplace/categories";
import { getMarketplaceListings } from "@/features/marketplace/queries";
import { cn } from "@/shared/utils";

type PageProps = {
  searchParams: Promise<{ category?: string; q?: string }>;
};

const MarketplacePage = async ({ searchParams }: PageProps) => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const { category, q } = await searchParams;
  const listings = await getMarketplaceListings({ category, q });

  const chip = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={cn(
        "rounded-full border-2 px-3 py-1 text-sm font-bold transition",
        active
          ? "border-green-500 bg-green-50 text-green-700"
          : "text-neutral-600 hover:bg-slate-50"
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="px-4">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-700">Course Library</h1>
        <p className="text-sm text-muted-foreground">
          Browse ready-made courses, then adopt one into your company to edit,
          translate, and assign to your crew.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip("/marketplace", "All", !category)}
        {MARKETPLACE_CATEGORIES.map((c) =>
          chip(
            `/marketplace?category=${c.slug}`,
            c.label,
            category === c.slug
          )
        )}
      </div>

      <form method="GET" className="mb-6 flex max-w-md items-center gap-2">
        {category && <input type="hidden" name="category" value={category} />}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search courses…"
          className="w-full rounded-xl border-2 px-4 py-2 text-sm outline-none focus:border-green-500"
        />
        <button
          type="submit"
          className="rounded-xl border-2 border-b-4 border-green-600 bg-green-500 px-4 py-2 text-sm font-bold text-white active:border-b-2"
        >
          Search
        </button>
      </form>

      {listings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No courses here yet{category ? " in this category" : ""}. Check back
          soon, or publish one of yours from the Studio.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <Link
              key={listing.id}
              href={`/marketplace/${listing.id}`}
              className="flex flex-col gap-y-2 rounded-2xl border-2 p-5 transition hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-x-2">
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">
                  {categoryLabel(listing.category)}
                </span>
                {listing.kind === "UNIVERSAL" ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                    Universal
                  </span>
                ) : listing.mine ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                    Yours
                  </span>
                ) : null}
              </div>
              <span className="font-bold text-neutral-700">{listing.title}</span>
              {listing.description && (
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {listing.description}
                </span>
              )}
              <span className="mt-1 text-xs font-medium text-muted-foreground">
                {languageLabel(listing.primaryLanguage)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default MarketplacePage;
