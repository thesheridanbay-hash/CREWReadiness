import "server-only";

import { cache } from "react";

import { eq } from "drizzle-orm";

import { subscriptions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/shared/db/scoped";

import { isStripeConfigured, TRIAL_DAYS } from "./stripe";

/**
 * Billing status (go-live B). 'unconfigured' whenever Stripe isn't set up —
 * the gate is then a NO-OP, so the app is never blocked before keys exist.
 * A 14-day trial is seeded lazily on first owner read.
 */

export type BillingState =
  | "unconfigured"
  | "trialing"
  | "active"
  | "past_due"
  | "expired";

export type BillingStatus = {
  state: BillingState;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  daysLeft: number;
  stripeConfigured: boolean;
  stripeCustomerId: string | null;
};

const DAY_MS = 86_400_000;

export const getBillingStatus = cache(async (): Promise<BillingStatus> => {
  const session = await getSession();
  const configured = isStripeConfigured();

  const base: BillingStatus = {
    state: "unconfigured",
    trialEndsAt: null,
    currentPeriodEnd: null,
    daysLeft: 0,
    stripeConfigured: configured,
    stripeCustomerId: null,
  };

  if (!session) return base;

  return scoped(session, async (tx) => {
    let row = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.companyId, session.companyId),
    });

    // Lazy-seed the trial on first read (idempotent).
    if (!row) {
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * DAY_MS);
      await tx
        .insert(subscriptions)
        .values({ companyId: session.companyId, status: "trialing", trialEndsAt })
        .onConflictDoNothing();
      row = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.companyId, session.companyId),
      });
    }

    const trialEndsAt = row?.trialEndsAt ?? null;
    const currentPeriodEnd = row?.currentPeriodEnd ?? null;
    const stripeCustomerId = row?.stripeCustomerId ?? null;
    const trialActive =
      trialEndsAt !== null && trialEndsAt.getTime() > Date.now();
    const daysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS))
      : 0;

    let state: BillingState;
    if (!configured) {
      state = "unconfigured";
    } else if (row?.status === "active") {
      state = "active";
    } else if (row?.status === "past_due") {
      state = "past_due";
    } else if (trialActive) {
      state = "trialing";
    } else {
      state = "expired";
    }

    return {
      state,
      trialEndsAt,
      currentPeriodEnd,
      daysLeft,
      stripeConfigured: configured,
      stripeCustomerId,
    };
  });
});

/** Owner/manager whose company is past trial with no active sub. */
export const isOwnerBlocked = (
  role: string | undefined,
  status: BillingStatus
): boolean =>
  (role === "owner" || role === "manager") && status.state === "expired";
