"use client";

import { useState } from "react";

import { ChevronDown, Settings2 } from "lucide-react";

import type { CourseAssetStatus } from "@/features/courses/actions/course-assets";
import type { CourseTranslationStatus } from "@/features/courses/actions/course-translate";
import type { CourseListingInfo } from "@/features/marketplace/actions";
import type {
  AssignTargets,
  CourseAssignmentRow,
} from "@/features/courses/assignment-queries";
import { cn } from "@/shared/utils";

import { AssignPanel } from "./assign-panel";
import { GenerateImagesButton } from "./generate-images-button";
import { MarketplacePublishPanel } from "./marketplace-publish-panel";
import { TranslatePanel } from "./translate-panel";

/**
 * Course-scoped admin (assign to crews, translate, marketplace, bulk image
 * generation) collected behind one disclosure, collapsed by default. These are
 * course-level, not lesson-level, so they belong here — not stacked above the
 * editor body (the old layout) and not crammed into the per-lesson inspector.
 * Keeping it collapsed means the default workspace view is the 3 panes, calm.
 */
export const CourseTools = ({
  courseId,
  assetStatus,
  translationStatus,
  listing,
  isPlatform,
  assignTargets,
  courseAssignments,
}: {
  courseId: number;
  assetStatus: CourseAssetStatus;
  translationStatus: CourseTranslationStatus;
  listing: CourseListingInfo;
  isPlatform: boolean;
  assignTargets: AssignTargets;
  courseAssignments: CourseAssignmentRow[];
}) => {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-4 rounded-2xl border-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Assign, translate, publish, and generate images for the whole course"
        className="flex w-full items-center justify-between gap-x-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-x-2">
          <Settings2 className="h-[18px] w-[18px] text-ink-3" strokeWidth={1.8} />
          <span className="text-sm font-bold text-ink">Course tools</span>
          <span className="text-xs text-muted-foreground">
            Assign · Translate · Marketplace · Images
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t-2 px-4 pb-4 pt-3">
          <div className="mb-3">
            <GenerateImagesButton courseId={courseId} status={assetStatus} />
          </div>

          <AssignPanel
            courseId={courseId}
            targets={assignTargets}
            current={courseAssignments}
          />

          <TranslatePanel courseId={courseId} status={translationStatus} />

          <MarketplacePublishPanel
            courseId={courseId}
            listing={listing}
            isPlatform={isPlatform}
          />
        </div>
      )}
    </section>
  );
};
