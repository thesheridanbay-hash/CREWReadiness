"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import type { BillingStatus } from "@/features/billing/status";

/**
 * Billing panel (go-live B): shows trial/subscription state and routes to
 * Stripe Checkout (subscribe) or the billing portal (manage). Inert messaging
 * when Stripe isn't configured yet.
 */
export const BillingPanel = ({ status }: { status: BillingStatus }) => {
  const [busy, setBusy] = useState(false);

  const go = async (path: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        toast.error(data.message ?? "Couldn't open billing. Try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!status.stripeConfigured) {
    return (
      <div className="rounded-2xl border-2 p-6">
        <p className="text-sm text-muted-foreground">
          Billing isn&apos;t connected yet. Once Stripe is set up, you&apos;ll
          subscribe and manage your plan here.
        </p>
      </div>
    );
  }

  const subscribe = (
    <Button variant="secondary" disabled={busy} onClick={() => go("/api/stripe/checkout")}>
      {busy ? "Opening…" : "Subscribe — $99/mo"}
    </Button>
  );
  const manage = (
    <Button variant="primaryOutline" disabled={busy} onClick={() => go("/api/stripe/portal")}>
      {busy ? "Opening…" : "Manage billing"}
    </Button>
  );

  return (
    <div className="rounded-2xl border-2 p-6">
      {status.state === "active" && (
        <>
          <p className="text-lg font-bold text-success-700">Subscription active</p>
          <p className="mt-1 text-sm text-muted-foreground">
            $99/mo
            {status.currentPeriodEnd
              ? ` · renews ${status.currentPeriodEnd.toLocaleDateString()}`
              : ""}
            .
          </p>
          <div className="mt-4">{manage}</div>
        </>
      )}

      {status.state === "trialing" && (
        <>
          <p className="text-lg font-bold text-ink">
            Free trial — {status.daysLeft} day{status.daysLeft === 1 ? "" : "s"} left
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscribe any time to keep building after your trial. Have a code?
            Enter it at checkout.
          </p>
          <div className="mt-4">{subscribe}</div>
        </>
      )}

      {status.state === "past_due" && (
        <>
          <p className="text-lg font-bold text-gold-700">Payment past due</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Update your payment method to keep your subscription active.
          </p>
          <div className="mt-4">{manage}</div>
        </>
      )}

      {status.state === "expired" && (
        <>
          <p className="text-lg font-bold text-danger">Trial ended</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscribe to keep building courses and training your crew.
          </p>
          <div className="mt-4">{subscribe}</div>
        </>
      )}
    </div>
  );
};
