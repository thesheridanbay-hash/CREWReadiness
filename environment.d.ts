// This file is needed to support autocomplete for process.env
export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // neon db uri — app runtime role (non-owner, subject to FORCE RLS)
      DATABASE_URL: string;

      // neon db uri — owner role, for migrations/rls.sql/seeds only
      DATABASE_URL_OWNER?: string;

      // public app url
      NEXT_PUBLIC_APP_URL: string;

      // better auth secret + base url (T2)
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL?: string;

      // dev-only auth bypass — never set in production
      DEV_AUTH_BYPASS?: string;
    }
  }
}
