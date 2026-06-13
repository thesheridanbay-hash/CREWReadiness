"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  publishCourseToMarketplace,
  unlistListing,
  type CourseListingInfo,
} from "@/actions/marketplace";
import { Button } from "@/components/ui/button";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace/categories";

/**
 * Publish-to-marketplace control in the course editor (course marketplace).
 * Owners pick a category + short description and publish; re-publishing updates
 * the existing listing, and Unlist takes it down (shared media stays public so
 * adopters don't break).
 */
export const MarketplacePublishPanel = ({
  courseId,
  listing,
}: {
  courseId: number;
  listing: CourseListingInfo;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState(
    listing?.category ?? MARKETPLACE_CATEGORIES[0].slug
  );
  const [description, setDescription] = useState(listing?.description ?? "");

  const publish = () =>
    startTransition(async () => {
      const result = await publishCourseToMarketplace({
        courseId,
        category,
        description,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        result.data.updated ? "Listing updated." : "Published to the library."
      );
      router.refresh();
    });

  const unlist = () => {
    if (!listing) return;
    startTransition(async () => {
      const result = await unlistListing({ listingId: listing.listingId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Taken down from the library.");
      router.refresh();
    });
  };

  const listed = listing?.status === "PUBLISHED";

  return (
    <section className="mb-6 rounded-2xl border-2 p-4">
      <div className="mb-1 flex items-center gap-x-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Marketplace
        </h2>
        {listing && (
          <span
            className={
              listed
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700"
                : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600"
            }
          >
            {listed ? "Listed" : "Unlisted"}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Share this course in the public library. Other companies adopt their own
        editable copy — your images are reused, not duplicated.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-y-1">
          <span className="text-xs font-bold text-neutral-700">Category</span>
          <select
            value={category}
            disabled={pending}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-xl border-2 px-3 py-1.5 text-sm font-medium text-neutral-700 outline-none focus:border-green-500 disabled:opacity-50"
          >
            {MARKETPLACE_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-y-1">
          <span className="text-xs font-bold text-neutral-700">
            Short description
          </span>
          <input
            value={description}
            maxLength={1000}
            disabled={pending}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this course teaches…"
            className="w-full rounded-xl border-2 px-3 py-1.5 text-sm outline-none focus:border-green-500 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" disabled={pending} onClick={publish}>
          {pending
            ? "Saving…"
            : listing
              ? "Update listing"
              : "Publish to marketplace"}
        </Button>
        {listed && (
          <Button variant="dangerOutline" disabled={pending} onClick={unlist}>
            Unlist
          </Button>
        )}
      </div>
    </section>
  );
};
