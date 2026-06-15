"use client";

import { useState } from "react";

import { Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/ui/button";
import type { LessonItemView } from "@/features/courses/lesson-item-schema";

import { Header } from "./header";

/**
 * Phase 2 lesson-anatomy player: steps the learner through the ordered teach
 * items one at a time, then hands off to the quiz via onComplete(). Each kind
 * renders differently (teaching markdown, wrong/right image pair, voice note,
 * field narrative). The render dispatcher is closed over the four known kinds;
 * the query already skips unknown/invalid items, so this never sees one.
 */

type TeachItemDispatcherProps = {
  items: LessonItemView[];
  percentage: number;
  onComplete: () => void;
};

const KIND_LABEL: Record<LessonItemView["kind"], string> = {
  teaching: "Learn this first",
  image_pair: "Spot the difference",
  voice_note: "Listen up",
  narrative: "From the field",
};

const ItemBody = ({ item }: { item: LessonItemView }) => {
  switch (item.kind) {
    case "teaching":
      return <Markdown>{item.markdown}</Markdown>;

    case "image_pair":
      return (
        <div className="flex flex-col gap-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ImageSide src={item.wrongSrc} tone="wrong" label="Don't" />
            <ImageSide src={item.rightSrc} tone="right" label="Do" />
          </div>
          {item.caption && (
            <p className="text-center text-base font-medium text-ink-2">
              {item.caption}
            </p>
          )}
        </div>
      );

    case "voice_note":
      return (
        <div className="flex flex-col gap-y-4">
          {item.audioSrc ? (
            <audio controls src={item.audioSrc} className="w-full">
              <track kind="captions" />
            </audio>
          ) : (
            <p className="rounded-xl border-2 border-line bg-canvas-2 p-3 text-sm font-medium text-ink-3">
              Audio is being prepared.
            </p>
          )}
          {item.transcript && <Markdown>{item.transcript}</Markdown>}
        </div>
      );

    case "narrative":
      return (
        <div className="flex flex-col gap-y-4">
          <Markdown>{item.text}</Markdown>
          {item.hook && (
            <div className="rounded-2xl border-2 border-gold bg-gold-50 p-4">
              <p className="text-base font-bold text-gold-700">{item.hook}</p>
            </div>
          )}
        </div>
      );
  }
};

const ImageSide = ({
  src,
  tone,
  label,
}: {
  src: string | null;
  tone: "wrong" | "right";
  label: string;
}) => (
  <div className="flex flex-col gap-y-2">
    <span
      className={
        tone === "right"
          ? "self-start rounded-full bg-success-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-success-700"
          : "self-start rounded-full bg-danger-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-danger-600"
      }
    >
      {label}
    </span>
    {src ? (
      // Dynamic blob URLs (no known dimensions) — show the whole image, no crop.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={
          tone === "right"
            ? "w-full rounded-2xl border-2 border-success object-contain"
            : "w-full rounded-2xl border-2 border-danger object-contain"
        }
      />
    ) : (
      <div className="flex aspect-square items-center justify-center rounded-2xl border-2 border-dashed border-line text-sm font-medium text-ink-3">
        Image pending
      </div>
    )}
  </div>
);

export const TeachItemDispatcher = ({
  items,
  percentage,
  onComplete,
}: TeachItemDispatcherProps) => {
  const [index, setIndex] = useState(0);
  const item = items[index];
  const isLast = index === items.length - 1;

  const advance = () => {
    if (isLast) onComplete();
    else setIndex((i) => i + 1);
  };

  return (
    <>
      <Header percentage={percentage} />
      <div className="flex-1">
        <div className="flex h-full items-center justify-center px-6 py-8">
          <div className="flex w-full max-w-[600px] flex-col gap-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold uppercase tracking-wide text-info">
                {KIND_LABEL[item.kind]}
              </p>
              {items.length > 1 && (
                <p className="text-xs font-bold text-ink-3">
                  {index + 1} of {items.length}
                </p>
              )}
            </div>

            <ItemBody item={item} />

            <Button variant="secondary" size="lg" onClick={advance}>
              {isLast ? "Start questions" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
