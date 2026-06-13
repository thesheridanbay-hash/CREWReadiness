import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import db from "@/db/drizzle";
import { STRIPE_WEBHOOK_SECRET, stripe } from "@/features/billing/stripe";

/**
 * Stripe webhook (go-live B). PUBLIC route (no session — Stripe calls it; see
 * proxy.ts PUBLIC_PATHS). Verifies the signature, then upserts the company's
 * subscription via app_upsert_subscription (SECURITY DEFINER — writes without
 * tenant context). companyId rides in the event metadata, stamped at checkout.
 */
export async function POST(request: NextRequest) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unconfigured" }, { status: 400 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  const upsert = async (args: {
    companyId: string | undefined;
    status: string;
    customer: string | null;
    subscription: string | null;
    periodEnd: number | null;
  }) => {
    if (!args.companyId) return;
    const periodIso = args.periodEnd
      ? new Date(args.periodEnd * 1000).toISOString()
      : null;
    await db.execute(sql`
      SELECT app_upsert_subscription(
        ${args.companyId}, ${args.status}, ${args.customer},
        ${args.subscription}, ${null}::timestamp, ${periodIso}::timestamp
      )
    `);
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const subId = typeof s.subscription === "string" ? s.subscription : null;
      let status = "active";
      let periodEnd: number | null = null;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        status = sub.status;
        periodEnd = sub.current_period_end;
      }
      await upsert({
        companyId: s.metadata?.companyId,
        status,
        customer: typeof s.customer === "string" ? s.customer : null,
        subscription: subId,
        periodEnd,
      });
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await upsert({
        companyId: sub.metadata?.companyId,
        status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
        customer: typeof sub.customer === "string" ? sub.customer : null,
        subscription: sub.id,
        periodEnd: sub.current_period_end,
      });
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
