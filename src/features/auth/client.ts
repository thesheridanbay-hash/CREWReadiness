"use client";

import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client (owner/manager/platform flows). */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
