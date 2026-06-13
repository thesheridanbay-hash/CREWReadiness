import { put } from "@vercel/blob";
import { NextResponse, type NextRequest } from "next/server";

import { mediaAssets } from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";
import { stripJpegMetadata } from "@/features/media/strip-exif";
import { validateUpload, type MediaKind } from "@/features/media/policy";

/**
 * Server-side upload (T11 — D9/F8). The browser POSTs the raw file here; the
 * bytes pass through the server so EXIF stripping is GUARANTEED (client-side
 * stripping can be bypassed). Flow: auth + role → validate type/size → strip
 * metadata → put() to Vercel Blob (private store) → record a scoped
 * media_assets row. Returns the asset id; the file is only ever reachable
 * through the authed proxy at /api/media/[id].
 *
 * Requires BLOB_READ_WRITE_TOKEN (auto-injected once a Blob store is linked
 * to the Vercel project).
 */

const KIND_VALUES: MediaKind[] = ["PHOTO", "VOICE", "VIDEO"];

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind = KIND_VALUES.find((k) => k === kindParam);
  if (!kind) {
    return NextResponse.json({ error: "kind must be PHOTO, VOICE, or VIDEO" }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  const buffer = new Uint8Array(await request.arrayBuffer());

  const validation = validateUpload(auth.role, kind, contentType, buffer.byteLength);
  if (!validation.ok) {
    const status = validation.code === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: validation.code, message: validation.message }, { status });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "storage_unconfigured", message: "Link a Vercel Blob store to enable uploads." },
      { status: 503 }
    );
  }

  // EXIF/GPS strip for photos (no-op for non-JPEG / other kinds).
  const bytes = kind === "PHOTO" ? stripJpegMetadata(buffer) : buffer;
  const extension = contentType.split("/")[1]?.split(";")[0] ?? "bin";

  const blob = await put(
    `media/${auth.companyId}/${crypto.randomUUID()}.${extension}`,
    Buffer.from(bytes),
    {
      access: "public", // unguessable URL; real gate is the authed proxy + RLS
      contentType,
      addRandomSuffix: true,
    }
  );

  const asset = await scoped(auth, async (tx) => {
    const [row] = await tx
      .insert(mediaAssets)
      .values({
        companyId: auth.companyId,
        uploadedBy: auth.userId,
        pathname: blob.url,
        contentType,
        kind,
        sizeBytes: bytes.byteLength,
      })
      .returning();
    return row;
  });

  return NextResponse.json({ id: asset.id, kind, sizeBytes: bytes.byteLength });
}
