"use client";

import { useState, useTransition } from "react";

import Image from "next/image";
import { useRouter } from "next/navigation";
import Confetti from "react-confetti";
import { useAudio, useWindowSize, useMount } from "react-use";
import { toast } from "sonner";

import { recordCorrectAnswer } from "@/actions/challenge-progress";
import { questionOptions, questions } from "@/db/schema";
import { usePracticeModal } from "@/store/use-practice-modal";

import { Challenge } from "./challenge";
import { Footer } from "./footer";
import { Header } from "./header";
import { QuestionBubble } from "./question-bubble";
import { ResultCard } from "./result-card";

/**
 * NOTE (D10/T3): hearts are gone — a wrong answer never blocks the session.
 * This component is reshaped onto the learning-loop state machine in P1 (T3):
 * wrong answers will route QUESTION → EXPLAIN → AI_RETEACH → VARIANT /
 * CONCEPT_PARKED, and every transition will be persisted. Until then, wrong
 * answers are client-side only (retry the same question).
 */

type QuizProps = {
  initialPercentage: number;
  initialLessonId: number;
  initialQuestions: (typeof questions.$inferSelect & {
    completed: boolean;
    questionOptions: (typeof questionOptions.$inferSelect)[];
  })[];
};

export const Quiz = ({
  initialPercentage,
  initialLessonId,
  initialQuestions,
}: QuizProps) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [correctAudio, _c, correctControls] = useAudio({ src: "/correct.wav" });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [incorrectAudio, _i, incorrectControls] = useAudio({
    src: "/incorrect.wav",
  });
  const [finishAudio] = useAudio({
    src: "/finish.mp3",
    autoPlay: true,
  });
  const { width, height } = useWindowSize();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { open: openPracticeModal } = usePracticeModal();

  useMount(() => {
    if (initialPercentage === 100) openPracticeModal();
  });

  const [lessonId] = useState(initialLessonId);
  const [percentage, setPercentage] = useState(() => {
    return initialPercentage === 100 ? 0 : initialPercentage;
  });
  const [lessonQuestions] = useState(initialQuestions);
  const [activeIndex, setActiveIndex] = useState(() => {
    const uncompletedIndex = lessonQuestions.findIndex(
      (question) => !question.completed
    );

    return uncompletedIndex === -1 ? 0 : uncompletedIndex;
  });

  const [selectedOption, setSelectedOption] = useState<number>();
  const [status, setStatus] = useState<"none" | "wrong" | "correct">("none");

  const question = lessonQuestions[activeIndex];
  const options = question?.questionOptions ?? [];

  const onNext = () => {
    setActiveIndex((current) => current + 1);
  };

  const onSelect = (id: number) => {
    if (status !== "none") return;

    setSelectedOption(id);
  };

  const onContinue = () => {
    if (!selectedOption) return;

    if (status === "wrong") {
      setStatus("none");
      setSelectedOption(undefined);
      return;
    }

    if (status === "correct") {
      onNext();
      setStatus("none");
      setSelectedOption(undefined);
      return;
    }

    const correctOption = options.find((option) => option.correct);

    if (!correctOption) return;

    if (correctOption.id === selectedOption) {
      startTransition(() => {
        recordCorrectAnswer(question.id)
          .then(() => {
            void correctControls.play();
            setStatus("correct");
            setPercentage((prev) => prev + 100 / lessonQuestions.length);
          })
          .catch(() => toast.error("Something went wrong. Please try again."));
      });
    } else {
      // TODO(T3): persist the wrong attempt + enter the reteach loop.
      void incorrectControls.play();
      setStatus("wrong");
    }
  };

  if (!question) {
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
          <Image
            src="/finish.svg"
            alt="Finish"
            className="hidden lg:block"
            height={100}
            width={100}
          />

          <Image
            src="/finish.svg"
            alt="Finish"
            className="block lg:hidden"
            height={100}
            width={100}
          />

          <h1 className="text-lg font-bold text-neutral-700 lg:text-3xl">
            Great job! <br /> You&apos;ve completed the lesson.
          </h1>

          <div className="flex w-full items-center justify-center gap-x-4">
            <ResultCard variant="points" value={lessonQuestions.length * 10} />
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

  const title =
    question.type === "ASSIST"
      ? "Select the correct meaning"
      : question.question;

  return (
    <>
      {incorrectAudio}
      {correctAudio}
      <Header percentage={percentage} />

      <div className="flex-1">
        <div className="flex h-full items-center justify-center">
          <div className="flex w-full flex-col gap-y-12 px-6 lg:min-h-[350px] lg:w-[600px] lg:px-0">
            <h1 className="text-center text-lg font-bold text-neutral-700 lg:text-start lg:text-3xl">
              {title}
            </h1>

            <div>
              {question.type === "ASSIST" && (
                <QuestionBubble question={question.question} />
              )}

              <Challenge
                options={options}
                onSelect={onSelect}
                status={status}
                selectedOption={selectedOption}
                disabled={pending}
                type={question.type}
              />
            </div>
          </div>
        </div>
      </div>

      <Footer
        disabled={pending || !selectedOption}
        status={status}
        onCheck={onContinue}
      />
    </>
  );
};
