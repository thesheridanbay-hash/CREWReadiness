import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { languageLabel } from "@/lib/content/languages";
import { categoryLabel } from "@/lib/marketplace/categories";
import { getListingDetail } from "@/lib/marketplace/queries";

import { AdoptButton } from "./adopt-button";

type PageProps = {
  params: Promise<{ listingId: string }>;
};

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-xl border-2 px-4 py-2 text-center">
    <div className="text-lg font-bold text-neutral-700">{value}</div>
    <div className="text-xs font-medium text-muted-foreground">{label}</div>
  </div>
);

const ListingDetailPage = async ({ params }: PageProps) => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const { listingId } = await params;
  const listing = await getListingDetail(listingId);
  if (!listing) redirect("/marketplace");

  const extraLanguages = listing.stats
    ? listing.stats.languages.length - 1
    : 0;

  return (
    <div className="px-4 pb-16">
      <Link
        href="/marketplace"
        className="text-sm font-bold text-sky-600 hover:underline"
      >
        ← Library
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-x-2">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">
              {categoryLabel(listing.category)}
            </span>
            {listing.kind === "UNIVERSAL" && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                Universal
              </span>
            )}
            {listing.mine && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                Yours
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-neutral-700">
            {listing.title}
          </h1>
          {listing.description && (
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {listing.description}
            </p>
          )}
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {languageLabel(listing.primaryLanguage)}
            {extraLanguages > 0 ? ` +${extraLanguages} more` : ""}
          </p>
        </div>

        {listing.mine ? (
          <span className="rounded-xl border-2 px-4 py-2 text-sm font-medium text-muted-foreground">
            This is your course.
          </span>
        ) : (
          <AdoptButton
            listingId={listing.id}
            alreadyAdopted={listing.alreadyAdopted}
          />
        )}
      </div>

      {listing.stats && (
        <div className="mt-5 flex flex-wrap gap-3">
          <Stat label="Lessons" value={listing.stats.lessons} />
          <Stat label="Questions" value={listing.stats.questions} />
          <Stat
            label="Images & audio"
            value={listing.stats.sharedAssets + listing.stats.pendingAssets}
          />
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          What&apos;s inside
        </h2>
        {listing.outline.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Course outline isn&apos;t available.
          </p>
        ) : (
          <div className="flex flex-col gap-y-3">
            {listing.outline.map((mod, mIdx) => (
              <div key={mIdx} className="rounded-2xl border-2 p-4">
                <p className="font-bold text-neutral-700">{mod.module}</p>
                <ul className="ml-5 mt-2 list-disc text-sm text-muted-foreground">
                  {mod.units.map((unit, uIdx) => (
                    <li key={uIdx}>
                      {unit.title}
                      <span className="text-neutral-400">
                        {" "}
                        · {unit.lessons.length} lesson
                        {unit.lessons.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ListingDetailPage;
