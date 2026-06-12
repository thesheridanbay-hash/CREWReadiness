import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { learningSessions, questionOptions, questions } from "@/db/schema";
import { reteach, type ReteachResult } from "@/lib/ai/gateway";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Live reteach stream (T8/D7). POST { sessionId } while the session is in the
 * AI_RETEACH step. Streams plain text teaching content (leak-guarded by the
 * gateway). Responds with JSON { fallback: true } when no provider is
 * configured, the call times out, or the guard refuses — the client then
 * calls completeReteach() and gets the variant question instead.
 *
 * The gateway meters + resolves the provider INSIDE the scoped transaction
 * and the returned stream performs no DB work (review finding #5).
 */

const bodySchema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await getSession();

  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const result: ReteachResult | { kind: "error" } = await scoped(
    auth,
    async (tx) => {
      const row = await tx.query.learningSessions.findFirst({
        where: eq(learningSessions.id, parsed.data.sessionId),
      });

      if (
        !row ||
        row.userId !== auth.userId ||
        row.step !== "AI_RETEACH" ||
        row.activeQuestionId === null
      ) {
        return { kind: "error" as const };
      }

      const question = await tx.query.questions.findFirst({
        where: eq(questions.id, row.activeQuestionId),
      });

      if (!question) return { kind: "error" as const };

      const correctOptions = await tx.query.questionOptions.findMany({
        where: and(
          eq(questionOptions.questionId, question.id),
          eq(questionOptions.correct, true)
        ),
      });

      return reteach(
        { tx, companyId: auth.companyId },
        {
          question: question.question,
          correctAnswers: correctOptions.map((option) => option.text),
        }
      );
    }
  );

  if (result.kind === "error") {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  if (result.kind === "fallback") {
    return NextResponse.json({ fallback: true, reason: result.reason });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          controller.enqueue(encoder.encode(chunk));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
