"use client";

import { useState, useTransition } from "react";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/actions";
import type { NotificationItem } from "@/features/courses/notification-queries";

/**
 * Notification inbox (go-live A2): a bell + unread badge in the app shell, with
 * a lightweight popover list. No extra UI deps — a backdrop handles
 * click-outside. Clicking an item marks it read and navigates.
 */
const timeAgo = (date: Date): string => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const NotificationBell = ({
  items,
  unread,
}: {
  items: NotificationItem[];
  unread: number;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const openItem = (item: NotificationItem) => {
    setOpen(false);
    startTransition(async () => {
      if (!item.read) await markNotificationRead({ id: item.id });
      router.push(item.href);
    });
  };

  const markAll = () => {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl p-2 text-neutral-500 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-12 left-0 z-50 w-72 rounded-2xl border-2 bg-white p-2 shadow-lg">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-sm font-bold text-neutral-700">
                Notifications
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={markAll}
                  className="text-xs font-bold uppercase text-sky-600 hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={pending}
                    onClick={() => openItem(item)}
                    className={`block w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 ${
                      item.read ? "text-muted-foreground" : "text-neutral-700"
                    }`}
                  >
                    <div className="flex items-start gap-x-2">
                      {!item.read && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" />
                      )}
                      <div className={item.read ? "ml-4" : ""}>
                        <div className="font-medium">{item.message}</div>
                        <div className="text-xs text-muted-foreground">
                          {timeAgo(item.createdAt)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
