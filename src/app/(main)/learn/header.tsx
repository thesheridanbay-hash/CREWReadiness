import type { ReactNode } from "react";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui/button";

type HeaderProps = {
  title: string;
  /** Optional right-side slot (e.g. the language switcher on the Learn page). */
  right?: ReactNode;
};

export const Header = ({ title, right }: HeaderProps) => {
  return (
    // Full-bleed sticky bar so the bottom rule runs edge-to-edge across the
    // content area (no "cut" line); inner row is centered to match the lesson
    // column width below. Title is Fraunces (the CrewYield display face).
    <div className="sticky top-0 z-30 mb-5 border-b-2 bg-surface lg:z-50 lg:-mt-7 lg:pt-7">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-x-3 px-6 py-3">
        <Link href="/courses" className="shrink-0">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-5 w-5 stroke-2 text-ink-3" />
          </Button>
        </Link>

        {/* min-w-0 + flex-1 lets the title shrink so `truncate` ellipsizes
            instead of hard-clipping next to the language switcher. */}
        <h1 className="min-w-0 flex-1 truncate font-display text-xl font-semibold text-ink">
          {title}
        </h1>
        <div className="shrink-0">{right ?? <div aria-hidden />}</div>
      </div>
    </div>
  );
};
