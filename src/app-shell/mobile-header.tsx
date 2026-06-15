import Link from "next/link";

import { Wordmark } from "@/shared/components/wordmark";

import { MobileSidebar } from "./mobile-sidebar";

export const MobileHeader = () => {
  return (
    <nav className="fixed top-0 z-50 flex h-[50px] w-full items-center gap-x-3 bg-brand px-4 lg:hidden">
      <MobileSidebar />
      <Link href="/learn">
        <Wordmark iconSize={26} textClass="text-base" onDark />
      </Link>
    </nav>
  );
};
