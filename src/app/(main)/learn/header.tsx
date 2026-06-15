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
    <div className="sticky top-0 mb-5 flex items-center justify-between gap-x-3 border-b-2 bg-surface pb-3 lg:z-50 lg:mt-[-28px] lg:pt-[28px]">
      <Link href="/courses" className="shrink-0">
        <Button size="sm" variant="ghost">
          <ArrowLeft className="h-5 w-5 stroke-2 text-ink-3" />
        </Button>
      </Link>

      {/* min-w-0 + flex-1 lets the title actually shrink so `truncate`
          ellipsizes instead of hard-clipping next to the language switcher
          (the bug on narrow/desktop both). text-ink keeps it on-brand. */}
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</h1>
      <div className="shrink-0">{right ?? <div aria-hidden />}</div>
    </div>
  );
};
