"use client";

import type { PropsWithChildren } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/shared/ui/button";

/**
 * Billing paywall (go-live B). When an owner/manager's trial has ended with no
 * active subscription, owner pages show this instead of content — except
 * /billing itself, so they can subscribe. Learners are never blocked.
 *
 * `blocked` is computed server-side and is FALSE whenever Stripe is
 * unconfigured, so this is a no-op until billing is set up.
 */
export const BillingGate = ({
  blocked,
  children,
}: PropsWithChildren<{ blocked: boolean }>) => {
  const pathname = usePathname();

  if (blocked && !pathname.startsWith("/billing")) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border-2 p-8 text-center">
          <h1 className="text-2xl font-bold text-neutral-700">
            Your free trial has ended
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Subscribe to keep building courses and training your crew. Your crew
            can still finish training they already have.
          </p>
          <div className="mt-5">
            <Button asChild variant="secondary">
              <Link href="/billing">See plans</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
