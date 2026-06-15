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

const SectionLabel = ({ children }: { children: string }) => (
  <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
    {children}
  </p>
);

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
        "left-0 top-0 flex h-full flex-col bg-brand px-3 text-white lg:fixed lg:w-[256px]",
        className
      )}
    >
      <Link href="/learn">
        <Wordmark
          iconSize={34}
          textClass="text-xl"
          onDark
          className="px-2 pb-5 pt-7"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-y-0.5 overflow-y-auto">
        <SidebarItem label="Learn" href="/learn" icon="home" />

        {canAuthor && (
          <>
            <SectionLabel>Manage</SectionLabel>
            <SidebarItem label="Studio" href="/studio" icon="studio" />
            <SidebarItem label="Incidents" href="/incidents" icon="incidents" />
            <SidebarItem label="Library" href="/marketplace" icon="library" />
            <SidebarItem label="Crew" href="/crew" icon="crew" />
            <SidebarItem label="Reports" href="/reports" icon="reports" />
            <SidebarItem
              label={parkedCount > 0 ? `Coaching (${parkedCount})` : "Coaching"}
              href="/coaching"
              icon="coaching"
            />
            <SidebarItem label="Billing" href="/billing" icon="billing" />
          </>
        )}

        {session?.role === "platform" && (
          <>
            <SectionLabel>Platform</SectionLabel>
            <SidebarItem label="AI Settings" href="/platform/settings" icon="settings" />
            <SidebarItem label="Usage" href="/platform/usage" icon="usage" />
          </>
        )}
      </div>

      <div className="flex flex-col gap-y-3 border-t border-white/10 p-3">
        <div className="flex items-center justify-between gap-x-3">
          <div className="flex items-center gap-x-3">
            <Image
              src={session?.imageSrc ?? "/mascot.svg"}
              alt="User"
              height={32}
              width={32}
              className="rounded-full border border-white/20"
            />
            <span className="text-sm font-bold text-white/80">
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
