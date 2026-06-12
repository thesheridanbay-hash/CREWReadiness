/**
 * TEMPORARY auth stub — replaced by Better Auth + organization plugin in T2 (D3/D11).
 *
 * Shape mirrors the locked decision: session claims carry { userId, companyId, role }
 * so call sites are unchanged when the real implementation lands. Do NOT add logic
 * here; T2 replaces this module wholesale.
 */

export type SessionRole = "platform" | "owner" | "manager" | "employee";

export type Session = {
  userId: string;
  companyId: string;
  role: SessionRole;
  name: string;
  imageSrc: string;
};

const DEV_SESSION: Session = {
  userId: "dev-user",
  companyId: "dev-company",
  role: "owner",
  name: "Dev User",
  imageSrc: "/mascot.svg",
};

/** Returns the current session, or null when unauthenticated. */
export const getSession = async (): Promise<Session | null> => {
  return DEV_SESSION;
};
