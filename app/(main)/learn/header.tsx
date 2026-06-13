import type { ReactNode } from "react";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

type HeaderProps = {
  title: string;
  /** Optional right-side slot (e.g. the language switcher on the Learn page). */
  right?: ReactNode;
};

export const Header = ({ title, right }: HeaderProps) => {
  return (
    <div className="sticky top-0 mb-5 flex items-center justify-between gap-x-3 border-b-2 bg-white pb-3 text-neutral-400 lg:z-50 lg:mt-[-28px] lg:pt-[28px]">
      <Link href="/courses">
        <Button size="sm" variant="ghost">
          <ArrowLeft className="h-5 w-5 stroke-2 text-neutral-400" />
        </Button>
      </Link>

      <h1 className="truncate text-lg font-bold">{title}</h1>
      <div className="shrink-0">{right ?? <div aria-hidden />}</div>
    </div>
  );
};
