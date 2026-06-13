import { NextResponse, type NextRequest } from "next/server";

import { EMPLOYEE_SESSION_COOKIE } from "@/lib/auth/employee-policy";

/**
 * Route protection (T2). Optimistic cookie-presence check only — middleware
 * can't validate sessions against the database. Real enforcement happens at
 * the data layer: getSession() + scoped() fail closed without valid context.
 */

const PUBLIC_PATHS = [
  "/sign-in",
  "/sign-up",
  "/invite",
  "/api/auth",
  // Stripe calls this with no session; it verifies its own signature.
  "/api/stripe/webhook",
];

const BETTER_AUTH_COOKIES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public marketing landing at "/".
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const hasOwnerSession = BETTER_AUTH_COOKIES.some((name) =>
    request.cookies.has(name)
  );
  const hasEmployeeSession = request.cookies.has(EMPLOYEE_SESSION_COOKIE);

  if (!hasOwnerSession && !hasEmployeeSession) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wav|mp3|css|js)).*)",
  ],
};
