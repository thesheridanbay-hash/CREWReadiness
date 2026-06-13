import Image from "next/image";
import Link from "next/link";

import { getSession } from "@/lib/auth/session";
import { getParkedCount } from "@/lib/content/coaching-queries";
import { getViewerLanguagePreference } from "@/lib/content/translations";
import { cn } from "@/lib/utils";

import { LanguageSwitcher } from "./language-switcher";
import { SidebarItem } from "./sidebar-item";

type SidebarProps = {
  className?: string;
};

export const Sidebar = async ({ className }: SidebarProps) => {
  const session = await getSession();
  const canAuthor = session?.role !== "employee";
  const parkedCount = canAuthor ? await getParkedCount() : 0;
  const languagePref = session
    ? await getViewerLanguagePreference()
    : { language: null, primary: "en" };

  return (
    <div
      className={cn(
        "left-0 top-0 flex h-full flex-col border-r-2 px-4 lg:fixed lg:w-[256px]",
        className
      )}
    >
      <Link href="/learn">
        <div className="flex items-center gap-x-3 pb-7 pl-4 pt-8">
          <Image src="/mascot.svg" alt="Mascot" height={40} width={40} />

          <h1 className="text-2xl font-extrabold tracking-wide text-green-600">
            CREWReadiness
          </h1>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-y-2">
        <SidebarItem label="Learn" href="/learn" iconSrc="/learn.svg" />
        <SidebarItem
          label="Leaderboard"
          href="/leaderboard"
          iconSrc="/leaderboard.svg"
        />
        <SidebarItem label="Quests" href="/quests" iconSrc="/quests.svg" />
        {canAuthor && (
          <SidebarItem label="Studio" href="/studio" iconSrc="/points.svg" />
        )}
        {canAuthor && (
          <SidebarItem
            label="Library"
            href="/marketplace"
            iconSrc="/finish.svg"
          />
        )}
        {canAuthor && (
          <SidebarItem label="Crew" href="/crew" iconSrc="/leaderboard.svg" />
        )}
        {canAuthor && (
          <SidebarItem label="Reports" href="/reports" iconSrc="/quests.svg" />
        )}
        {canAuthor && (
          <SidebarItem
            label={parkedCount > 0 ? `Coaching (${parkedCount})` : "Coaching"}
            href="/coaching"
            iconSrc="/mascot_bad.svg"
          />
        )}
        {session?.role === "platform" && (
          <SidebarItem
            label="AI Settings"
            href="/platform/settings"
            iconSrc="/mascot.svg"
          />
        )}
        {session?.role === "platform" && (
          <SidebarItem
            label="Usage"
            href="/platform/usage"
            iconSrc="/points.svg"
          />
        )}
      </div>

      <div className="flex flex-col gap-y-3 p-4">
        {session && (
          <LanguageSwitcher
            current={languagePref.language}
            primary={languagePref.primary}
          />
        )}
        <div className="flex items-center gap-x-3">
          <Image
            src={session?.imageSrc ?? "/mascot.svg"}
            alt="User"
            height={32}
            width={32}
            className="rounded-full border"
          />
          <span className="text-sm font-bold text-neutral-500">
            {session?.name ?? "Guest"}
          </span>
        </div>
      </div>
    </div>
  );
};
