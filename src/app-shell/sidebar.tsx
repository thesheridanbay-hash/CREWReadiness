import Image from "next/image";
import Link from "next/link";

import { getSession } from "@/features/auth/session";
import { getParkedCount } from "@/features/courses/coaching-queries";
import { getMyNotifications } from "@/features/courses/notification-queries";
import { cn } from "@/shared/utils";

import { NotificationBell } from "./notification-bell";
import { SidebarItem } from "@/shared/components/sidebar-item";
import { Wordmark } from "@/shared/components/wordmark";

type SidebarProps = {
  className?: string;
};

export const Sidebar = async ({ className }: SidebarProps) => {
  const session = await getSession();
  const canAuthor = session?.role !== "employee";
  const parkedCount = canAuthor ? await getParkedCount() : 0;
  const notifications = session
    ? await getMyNotifications()
    : { items: [], unread: 0 };

  return (
    <div
      className={cn(
        "left-0 top-0 flex h-full flex-col border-r-2 px-4 lg:fixed lg:w-[256px]",
        className
      )}
    >
      <Link href="/learn">
        <Wordmark iconSize={40} textClass="text-2xl" className="pb-7 pl-4 pt-8" />
      </Link>

      <div className="flex flex-1 flex-col gap-y-2">
        <SidebarItem label="Learn" href="/learn" iconSrc="/learn.svg" />
        {canAuthor && (
          <SidebarItem label="Studio" href="/studio" iconSrc="/points.svg" />
        )}
        {canAuthor && (
          <SidebarItem
            label="Incidents"
            href="/incidents"
            iconSrc="/mascot_bad.svg"
          />
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
        {canAuthor && (
          <SidebarItem label="Billing" href="/billing" iconSrc="/points.svg" />
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
        <div className="flex items-center justify-between gap-x-3">
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
          {session && (
            <NotificationBell
              items={notifications.items}
              unread={notifications.unread}
            />
          )}
        </div>
      </div>
    </div>
  );
};
