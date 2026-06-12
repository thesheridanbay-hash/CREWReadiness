import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureRequestError: vi.fn(),
}));

import { TenantContextError } from "@/lib/db/scoped";
import { AppActionError, err, fromZod, guard, ok } from "@/lib/errors";

describe("Result envelope (T7/D15)", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("ok() wraps data", () => {
    expect(ok({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
  });

  it("err() carries code and message", () => {
    const result = err("not_found", "Missing.");
    expect(result).toEqual({
      ok: false,
      error: { code: "not_found", message: "Missing." },
    });
  });

  it("fromZod() maps issues to fieldErrors", () => {
    const schema = z.object({ pin: z.string().length(4) });
    const parsed = schema.safeParse({ pin: "12" });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const result = fromZod(parsed.error);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors?.pin).toBeDefined();
  });

  it("guard() passes through ok results", async () => {
    const result = await guard(async () => ok("done"));
    expect(result).toEqual({ ok: true, data: "done" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("guard() converts AppActionError without reporting to Sentry", async () => {
    const result = await guard(async () => {
      throw new AppActionError("forbidden", "Managers only.");
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Managers only." },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("guard() converts TenantContextError without reporting to Sentry", async () => {
    const result = await guard(async () => {
      throw new TenantContextError("no company");
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("tenant_context");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("guard() reports unknown errors to Sentry as unexpected", async () => {
    const boom = new Error("boom");
    const result = await guard(async () => {
      throw boom;
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unexpected");
    expect(captureException).toHaveBeenCalledWith(boom);
  });

  it("guard() re-throws Next.js redirect control flow", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/learn;307;",
    });

    await expect(
      guard(async () => {
        throw redirectError;
      })
    ).rejects.toBe(redirectError);
    expect(captureException).not.toHaveBeenCalled();
  });
});
