import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import db from "@/db/drizzle";
import { mediaAssets } from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";

/**
 * Authed media proxy (T11 — D9/F8). Field photos contain faces, customer
 * property, and (pre-strip) GPS, so they are NEVER served by a guessable
 * public URL. Every fetch passes through here: the scoped lookup means RLS
 * only returns the row when the requester's company owns it — a member of
 * another company gets a 404, not the file. The underlying Blob URL is never
 * exposed to the client.
 *
 * Marketplace exception (course marketplace): media belonging to a course
 * published to the marketplace is flagged public, so an adopting company can
 * render the SAME blobs it references (no copy/regenerate). That read goes
 * through app_get_public_media() — a SECURITY DEFINER gated on public=true —
 * and ONLY after the owned lookup misses. An authed session is still required,
 * so truly anonymous callers never reach the bytes.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 1) Owned media (tenant-scoped: RLS returns it only for this company).
  const owned = await scoped(auth, (tx) =>
    tx.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, id) })
  );

  let pathname = owned?.pathname ?? null;
  let contentType = owned?.contentType ?? "application/octet-stream";

  // 2) Public marketplace media (shared by reference). Definer-gated on
  //    public=true; the authed check above still applies.
  if (!pathname) {
    const result = await db.execute<{ pathname: string; content_type: string }>(
      sql`SELECT pathname, content_type FROM app_get_public_media(${id}::uuid)`
    );
    const row = result.rows[0];
    if (row) {
      pathname = row.pathname;
      contentType = row.content_type;
    }
  }

  if (!pathname) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const upstream = await fetch(pathname);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      // Private: authed-user cache only, never shared/CDN caches.
      "Cache-Control": "private, max-age=300",
    },
  });
}
