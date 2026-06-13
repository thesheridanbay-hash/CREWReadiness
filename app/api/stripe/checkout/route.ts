import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscriptions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  STRIPE_PRICE_ID,
  isStripeConfigured,
  stripe,
} from "@/features/billing/stripe";
import { scoped } from "@/shared/db/scoped";

/**
 * Start a Stripe Checkout for the $99/mo plan (go-live B). Owner/manager only.
 * Promo codes are enabled at checkout (the owner creates comp/discount codes in
 * Stripe). companyId is stamped on the customer + subscription so the webhook
 * can resolve the tenant without a session.
 */
export async function POST() {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isStripeConfigured() || !stripe) {
    return NextResponse.json(
      { error: "unconfigured", message: "Billing isn't set up yet." },
      { status: 400 }
    );
  }

  // Non-null local so narrowing survives into the async closure below.
  const client = stripe;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Create or reuse the company's Stripe customer (stamped with companyId).
  const customerId = await scoped(auth, async (tx) => {
    const row = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.companyId, auth.companyId),
    });
    if (row?.stripeCustomerId) return row.stripeCustomerId;

    const customer = await client.customers.create({
      name: auth.name,
      metadata: { companyId: auth.companyId },
    });

    await tx
      .insert(subscriptions)
      .values({
        companyId: auth.companyId,
        status: row?.status ?? "trialing",
        stripeCustomerId: customer.id,
        trialEndsAt: row?.trialEndsAt ?? null,
      })
      .onConflictDoUpdate({
        target: subscriptions.companyId,
        set: { stripeCustomerId: customer.id },
      });

    return customer.id;
  });

  const checkout = await client.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { companyId: auth.companyId } },
    success_url: `${appUrl}/billing?success=1`,
    cancel_url: `${appUrl}/billing?canceled=1`,
    metadata: { companyId: auth.companyId },
  });

  return NextResponse.json({ url: checkout.url });
}
