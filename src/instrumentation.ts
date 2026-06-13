import * as Sentry from "@sentry/nextjs";

/**
 * Sentry wiring (T7 — D15). No-ops when SENTRY_DSN is unset, so local dev
 * and preview environments work without configuration. The error envelope
 * (lib/errors) reports only the `unexpected` class here.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    enabled: Boolean(process.env.SENTRY_DSN),
  });
}

export const onRequestError = Sentry.captureRequestError;
