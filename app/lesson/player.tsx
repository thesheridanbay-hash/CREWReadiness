"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import Confetti from "react-confetti";
import { useAudio, useWindowSize } from "react-use";
import { toast } from "sonner";

import {
  acknowledgeExplain,
  completeReteach,
  submitAnswer,
  type LoopActionResult,
} from "@/actions/learning-loop";
import { Markdown } from "@/components/markdown";
import { Button } from "@/shared/ui/button";
import type { LessonTeaching } from "@/lib/content/queries";
import type { LoopView } from "@/lib/learning-loop/views";
import type { Result } from "@/shared/errors";

import { Challenge } from "./challenge";
import { Footer } from "./footer";
import { Header } from "./header";
import { ResultCard } from "./result-card";

/**
 * Lesson player (T8): renders server-driven LoopViews. The full teach-back
 * ladder — wrong → EXPLAIN → retry → AI RETEACH → variant → park-and-continue
 * — is decided by the state machine server-side; this component only renders
 * the current view and reports events.
 */

type PlayerProps = {
  sessionId: string;
  lessonId: number;
  initialView: LoopView;
  /** Teaching content shown before the questions (AI Course Builder). */
  teaching?: LessonTeaching | null;
};

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const Player = ({
  sessionId,
  lessonId,
  initialView,
  teaching,
}: PlayerProps) => {
  const router = useRouter();
  const { width, height } = useWindowSize();
  const [pending, startTransition] = useTransition();

  // "Learn" step: show the teaching content before the questions. Skipped when
  // there's nothing to teach or the lesson is already complete (resumed).
  const [phase, setPhase] = useState<"teach" | "quiz">(
    teaching && initialView.type !== "COMPLETE" ? "teach" : "quiz"
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [correctAudio, _c, correctControls] = useAudio({ src: "/correct.wav" });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [incorrectAudio, _i, incorrectControls] = useAudio({
    src: "/incorrect.wav",
  });
  const [finishAudio, , finishControls] = useAudio({ src: "/finish.mp3" });

  const [view, setView] = useState<LoopView>(initialView);
  const [selectedRef, setSelectedRef] = useState<number>();
  const [feedback, setFeedback] = useState<"none" | "correct" | "wrong">("none");
  const [reteachText, setReteachText] = useState("");
  const reteachStarted = useRef(false);

  const applyResult = useCallback(
    (result: Result<LoopActionResult> | undefined, wasCorrect?: boolean) => {
      if (!result) return;
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      if (wasCorrect === true) void correctControls.play();
      if (wasCorrect === false) void incorrectControls.play();

      const nextView = result.data.view;
      if (nextView.type === "COMPLETE") void finishControls.play();
      if (
        (nextView.type === "QUESTION" || nextView.type === "COMPLETE") &&
        nextView.banner === "PARKED"
      ) {
        toast.info(
          "That one's parked for in-person coaching — your manager has been notified. Moving on!"
        );
      }

      // Every transition changes the rendered view, so option feedback resets.
      setView(result.data.view);
      setSelectedRef(undefined);
      setFeedback("none");
      reteachStarted.current = false;
      setReteachText("");
    },
    [correctControls, incorrectControls, finishControls]
  );

  /* ── RETEACH: stream teaching content, fall back to the variant ── */
  useEffect(() => {
    if (view.type !== "RETEACH" || reteachStarted.current) return;
    reteachStarted.current = true;

    const run = async () => {
      try {
        const response = await fetch("/api/reteach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
          // Never let a stalled provider freeze the learner — fall through to
          // the variant if the whole exchange hasn't resolved in time.
          signal: AbortSignal.timeout(25_000),
        });

        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json") || !response.body) {
          // Fallback: no provider / timeout / guard — go straight to the variant.
          const result = await completeReteach({
            sessionId,
            questionId: view.questionId,
            idempotencyKey: newKey(),
          });
          applyResult(result);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          setReteachText((prev) => prev + decoder.decode(value, { stream: true }));
        }
      } catch {
        const result = await completeReteach({
          sessionId,
          questionId: view.questionId,
          idempotencyKey: newKey(),
        });
        applyResult(result);
      }
    };

    void run();
  }, [view, sessionId, applyResult]);

  /* ── Handlers ── */

  const onCheck = () => {
    if (view.type !== "QUESTION" || selectedRef === undefined) return;

    const surface = view.surface;

    startTransition(async () => {
      const result = await submitAnswer({
        sessionId,
        questionId: surface.questionId,
        surface: surface.kind,
        variantId: surface.kind === "VARIANT" ? surface.variantId : null,
        optionRef: selectedRef,
        idempotencyKey: newKey(),
      });

      const correct =
        result.ok &&
        (result.data.pointsEarned > 0 ||
          result.data.view.type === "COMPLETE");
      applyResult(result, result.ok ? correct : undefined);
    });
  };

  const onExplainContinue = () => {
    if (view.type !== "EXPLAIN") return;
    startTransition(async () => {
      const result = await acknowledgeExplain({
        sessionId,
        questionId: view.questionId,
        idempotencyKey: newKey(),
      });
      applyResult(result);
    });
  };

  const onReteachContinue = () => {
    if (view.type !== "RETEACH") return;
    startTransition(async () => {
      const result = await completeReteach({
        sessionId,
        questionId: view.questionId,
        idempotencyKey: newKey(),
      });
      applyResult(result);
    });
  };

  const percentage =
    view.progress.total > 0
      ? (view.progress.completed / view.progress.total) * 100
      : 0;

  /* ── LEARN (teaching step, before the questions) ── */
  if (phase === "teach" && teaching) {
    return (
      <>
        <Header percentage={percentage} />
        <div className="flex-1">
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="flex w-full max-w-[600px] flex-col gap-y-6">
              <p className="text-sm font-bold uppercase tracking-wide text-sky-600">
                Learn this first
              </p>
              {teaching.imageSrc && (
                // Show the WHOLE illustration (no crop), capped for mobile.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={teaching.imageSrc}
                  alt=""
                  className="mx-auto block max-h-[55vh] w-full max-w-[480px] rounded-2xl border-2 object-contain"
                />
              )}
              {teaching.text && <Markdown>{teaching.text}</Markdown>}
              {teaching.audioSrc && (
                <audio controls src={teaching.audioSrc} className="w-full">
                  <track kind="captions" />
                </audio>
              )}
              <Button variant="secondary" size="lg" onClick={() => setPhase("quiz")}>
                Start questions
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── COMPLETE ── */
  if (view.type === "COMPLETE") {
    return (
      <>
        {finishAudio}
        <Confetti
          recycle={false}
          numberOfPieces={500}
          tweenDuration={10_000}
          width={width}
          height={height}
        />
        <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-y-4 text-center lg:gap-y-8">
          <Image src="/finish.svg" alt="Finish" height={100} width={100} />
          <h1 className="text-lg font-bold text-neutral-700 lg:text-3xl">
            Great job! <br /> You&apos;ve completed the lesson.
          </h1>
          {view.banner === "PARKED" && (
            <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              One concept was parked for in-person coaching — your manager will
              follow up.
            </p>
          )}
          <div className="flex w-full items-center justify-center gap-x-4">
            <ResultCard variant="points" value={view.pointsEarned} />
          </div>
        </div>
        <Footer
          lessonId={lessonId}
          status="completed"
          onCheck={() => router.push("/learn")}
        />
      </>
    );
  }

  /* ── EXPLAIN ── */
  if (view.type === "EXPLAIN") {
    return (
      <>
        {incorrectAudio}
        {correctAudio}
        <Header percentage={percentage} />
        <div className="flex-1">
          <div className="flex h-full items-center justify-center px-6">
            <div className="flex w-full max-w-[600px] flex-col gap-y-6">
              <div className="flex items-start gap-x-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-6">
                <Image src="/mascot_bad.svg" alt="" height={48} width={48} />
                <div>
                  <h2 className="mb-2 text-lg font-bold text-amber-900">
                    Not quite — here&apos;s why it matters
                  </h2>
                  <p className="text-base font-medium text-amber-900">
                    {view.explanation}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="lg"
                onClick={onExplainContinue}
                disabled={pending}
              >
                Got it — try again
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── RETEACH ── */
  if (view.type === "RETEACH") {
    return (
      <>
        <Header percentage={percentage} />
        <div className="flex-1">
          <div className="flex h-full items-center justify-center px-6">
            <div className="flex w-full max-w-[600px] flex-col gap-y-6">
              <div className="flex items-start gap-x-4 rounded-2xl border-2 border-sky-300 bg-sky-50 p-6">
                <Image src="/mascot.svg" alt="" height={48} width={48} />
                <div>
                  <h2 className="mb-2 text-lg font-bold text-sky-900">
                    Let&apos;s look at it another way
                  </h2>
                  <p className="min-h-[48px] whitespace-pre-wrap text-base font-medium text-sky-900">
                    {reteachText || "Thinking…"}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="lg"
                onClick={onReteachContinue}
                disabled={pending}
              >
                Try a fresh question
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── QUESTION (original or variant) ── */
  const surface = view.surface;
  const title =
    surface.kind === "ORIGINAL" && surface.questionType === "ASSIST"
      ? "Select the correct meaning"
      : surface.prompt;

  return (
    <>
      {incorrectAudio}
      {correctAudio}
      <Header percentage={percentage} />
      <div className="flex-1">
        <div className="flex h-full items-center justify-center">
          <div className="flex w-full flex-col gap-y-12 px-6 lg:min-h-[350px] lg:w-[600px] lg:px-0">
            <div>
              {surface.kind === "VARIANT" && (
                <p className="mb-2 text-sm font-bold uppercase tracking-wide text-sky-600">
                  Fresh question, same idea
                </p>
              )}
              <h1 className="text-center text-lg font-bold text-neutral-700 lg:text-start lg:text-3xl">
                {title}
              </h1>
            </div>

            <Challenge
              options={surface.options.map((option) => ({
                id: option.ref,
                text: option.text,
                imageSrc: option.imageSrc ?? null,
                audioSrc: option.audioSrc ?? null,
              }))}
              onSelect={(ref) => {
                if (feedback === "none" || feedback === "wrong") {
                  setFeedback("none");
                  setSelectedRef(ref);
                }
              }}
              status={feedback}
              selectedOption={selectedRef}
              disabled={pending}
              type={
                surface.kind === "ORIGINAL" ? surface.questionType : "SELECT"
              }
            />
          </div>
        </div>
      </div>
      <Footer
        disabled={pending || selectedRef === undefined}
        status={feedback === "wrong" ? "wrong" : "none"}
        onCheck={onCheck}
      />
    </>
  );
};
