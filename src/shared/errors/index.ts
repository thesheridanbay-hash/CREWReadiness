import * as Sentry from "@sentry/nextjs";
import type { ZodError } from "zod";

import { TenantContextError } from "@/lib/db/scoped";

/**
 * Typed result envelope (T7 — D15).
 *
 * Every server action and route handler returns Result<T> instead of throwing
 * across the boundary. Classified failures carry a stable `code` the UI can
 * branch on; only the `unexpected` class is reported to Sentry — expected
 * failures (validation, auth, not-found) are signal for the user, not for
 * the error tracker.
 */

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "tenant_context"
  | "unexpected";

export type AppError = {
  code: ErrorCode;
  message: string;
  /** Per-field messages for form validation failures. */
  fieldErrors?: Record<string, string[]>;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <T = never>(
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>
): Result<T> => ({
  ok: false,
  error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) },
});

/** Map a zod parse failure to a validation envelope. */
export const fromZod = <T = never>(error: ZodError): Result<T> => {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
  }

  return err("validation", "Invalid input.", fieldErrors);
};

/**
 * AppActionError: throw inside guarded code to short-circuit with a classified
 * envelope (the guard converts it). Prefer returning err(...) directly where
 * practical; this exists for deep call stacks.
 */
export class AppActionError extends Error {
  readonly code: Exclude<ErrorCode, "unexpected">;

  constructor(code: Exclude<ErrorCode, "unexpected">, message: string) {
    super(message);
    this.name = "AppActionError";
    this.code = code;
  }
}

const isRedirectError = (error: unknown): boolean =>
  error instanceof Error &&
  "digest" in error &&
  typeof (error as { digest?: unknown }).digest === "string" &&
  ((error as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
    (error as { digest: string }).digest === "NEXT_NOT_FOUND");

/**
 * Wrap a server-action body: classified errors become envelopes, Next.js
 * control-flow errors (redirect/notFound) re-throw untouched, and anything
 * else is captured to Sentry and returned as `unexpected`.
 */
export const guard = async <T>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
  try {
    return await fn();
  } catch (error) {
    if (isRedirectError(error)) throw error;

    if (error instanceof AppActionError) {
      return err(error.code, error.message);
    }

    if (error instanceof TenantContextError) {
      return err("tenant_context", "No company context for this request.");
    }

    Sentry.captureException(error);

    return err("unexpected", "Something went wrong. Please try again.");
  }
};
