import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { subscriptions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { isStripeConfigured, stripe } from "@/features/billing/stripe";
import { scoped } from "@/shared/db/scoped";

/**
 * Open the Stripe billing portal (manage/cancel/update card) for the company's
 * customer (go-live B). Owner/manager only.
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
    return NextResponse.json({ error: "unconfigured" }, { status: 400 });
  }

  const customerId = await scoped(auth, async (tx) => {
    const row = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.companyId, auth.companyId),
    });
    return row?.stripeCustomerId ?? null;
  });

  if (!customerId) {
    return NextResponse.json(
      { error: "no_customer", message: "Start a subscription first." },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/billing`,
  });

  return NextResponse.json({ url: portal.url });
}
