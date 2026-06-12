import "dotenv/config";
import type { Config } from "drizzle-kit";

/**
 * Migrations run as the database OWNER role (D14): use DATABASE_URL_OWNER.
 * The app itself runs as the non-owner `app_runtime` role via DATABASE_URL —
 * that role cannot ALTER tables and is subject to FORCE RLS (db/rls.sql).
 */
const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL_OWNER (or DATABASE_URL) is not defined");
}

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
