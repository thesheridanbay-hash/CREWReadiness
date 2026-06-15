"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CreditCard,
  GraduationCap,
  Home,
  Library,
  type LucideIcon,
  Sparkles,
  SquarePen,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/shared/utils";

/** Icon set keyed by name — the server Sidebar passes a string (functions
 * can't cross the server→client boundary as props); we resolve it here. */
const ICONS = {
  home: Home,
  studio: SquarePen,
  incidents: AlertTriangle,
  library: Library,
  crew: Users,
  reports: BarChart3,
  coaching: GraduationCap,
  billing: CreditCard,
  settings: Sparkles,
  usage: Activity,
} satisfies Record<string, LucideIcon>;

export type SidebarIcon = keyof typeof ICONS;

type SidebarItemProps = {
  label: string;
  icon: SidebarIcon;
  href: string;
};

/**
 * Pine-rail nav item (CrewYield family): clean stroke icon + label, gold
 * active state with pine-ink text, light text on pine otherwise.
 */
export const SidebarItem = ({ label, icon, href }: SidebarItemProps) => {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = ICONS[icon];

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-x-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
        isActive
          ? "bg-gold-500 text-brand-800"
          : "text-white/75 hover:bg-white/10 hover:text-white"
      )}
    >
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          isActive ? "text-brand-800" : "text-white/70"
        )}
        strokeWidth={1.8}
      />
      {label}
    </Link>
  );
};
