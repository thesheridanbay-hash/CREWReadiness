import { cache } from "react";

import { sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Incident reads (go-live C). Surfaces the pending photo-drafted lessons so the
 * owner can see what's awaiting review on the Incidents page.
 */

export type IncidentDraft = {
  reviewItemId: number;
  title: string;
  createdAt: Date;
};

export const getRecentIncidents = cache(async (): Promise<IncidentDraft[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  const rows = await scoped(session, (tx) =>
    tx.execute<{ id: number; title: string | null; created_at: string }>(sql`
      SELECT rq.id, rq.draft->>'title' AS title, rq.created_at
      FROM review_queue rq
      JOIN ai_jobs j ON j.id = rq.job_id
      WHERE j.kind = 'PHOTO_TO_TRAINING' AND rq.status = 'PENDING'
      ORDER BY rq.created_at DESC
      LIMIT 10
    `)
  );

  return rows.rows.map((row) => ({
    reviewItemId: row.id,
    title: row.title ?? "Untitled lesson",
    createdAt: new Date(row.created_at),
  }));
});
