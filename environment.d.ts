// This file is needed to support autocomplete for process.env
export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // neon db uri
      DATABASE_URL: string;

      // public app url
      NEXT_PUBLIC_APP_URL: string;
    }
  }
}
