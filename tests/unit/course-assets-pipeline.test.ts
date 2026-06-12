import { describe, expect, it } from "vitest";

import {
  imageKindFor,
  mediaProxyPath,
} from "@/inngest/functions/generate-course-assets";

/**
 * Pure helpers from the sequential asset pipeline. The drain loop's sequencing
 * and idempotency are structural (Inngest steps + status re-checks); these
 * cover the mapping the gateway and proxy depend on.
 */

describe("imageKindFor", () => {
  it("maps stored kinds to the gateway's style-prime kinds", () => {
    expect(imageKindFor("ICON")).toBe("icon");
    expect(imageKindFor("ILLUSTRATION")).toBe("illustration");
    expect(imageKindFor("REALISTIC")).toBe("realistic");
  });
});

describe("mediaProxyPath", () => {
  it("routes generated images through the authed proxy, not a hotlink", () => {
    expect(mediaProxyPath("abc-123")).toBe("/api/media/abc-123");
  });
});
