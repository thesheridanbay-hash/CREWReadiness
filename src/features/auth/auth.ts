import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

// Relative imports (not @/ aliases) so the better-auth CLI can load this
// config for schema generation.
import * as authSchema from "../../db/auth-schema";
import db from "../../db/drizzle";

/**
 * Better Auth instance (T2 — D3/D11).
 *
 * Covers owner / manager / platform accounts (email + password) and
 * companies via the organization plugin (company = organization; member
 * roles: owner | admin -> "owner" tier, member -> "manager").
 *
 * Employees do NOT live here: the D4 spike outcome (see PR notes) is that
 * org-scoped usernames (same username at two companies) conflict with
 * global-unique username semantics, so employees use the plan's fallback —
 * a separate credential table with hardened PIN sign-in (lib/auth/employee.ts).
 *
 * Secret: BETTER_AUTH_SECRET (required in production).
 * Base URL: BETTER_AUTH_URL (falls back to NEXT_PUBLIC_APP_URL).
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      /** Platform-owner flag (cross-company area). Never user-settable. */
      platformOwner: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [organization(), nextCookies()],
});

export type BetterAuthSession = typeof auth.$Infer.Session;
