import "server-only";

import Stripe from "stripe";

/**
 * Stripe wrapper (go-live B). Billing is INERT until the env keys are set —
 * isStripeConfigured() gates every billing behavior, so the app runs normally
 * with no Stripe account (dev, and prod before the owner sets keys).
 */

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

/** $99/mo plan; 14-day trial. */
export const PLAN_PRICE_USD = 99;
export const TRIAL_DAYS = 14;

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";

/** Configured = we can both create checkouts (key) and charge a plan (price). */
export const isStripeConfigured = (): boolean =>
  Boolean(secretKey) && Boolean(STRIPE_PRICE_ID);

/** The Stripe client, or null when unconfigured (callers must guard). */
export const stripe: Stripe | null = secretKey
  ? new Stripe(secretKey)
  : null;
