import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { mediaAssets } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Authed media proxy (T11 — D9/F8). Field photos contain faces, customer
 * property, and (pre-strip) GPS, so they are NEVER served by a guessable
 * public URL. Every fetch passes through here: the scoped lookup means RLS
 * only returns the row when the requester's company owns it — a member of
 * another company gets a 404, not the file. The underlying Blob URL is never
 * exposed to the client.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const asset = await scoped(auth, (tx) =>
    tx.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, id) })
  );

  // RLS already scopes to the company; treat anything missing as not-found.
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const upstream = await fetch(asset.pathname);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": asset.contentType,
      // Private: authed-user cache only, never shared/CDN caches.
      "Cache-Control": "private, max-age=300",
    },
  });
}
