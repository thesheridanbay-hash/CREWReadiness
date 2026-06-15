import { useCallback } from "react";

import Image from "next/image";
import { useAudio, useKey } from "react-use";

import { questions } from "@/db/schema";
import { cn } from "@/shared/utils";

type CardProps = {
  id: number;
  text: string;
  imageSrc: string | null;
  audioSrc: string | null;
  shortcut: string;
  selected?: boolean;
  onClick: () => void;
  status?: "correct" | "wrong" | "none";
  disabled?: boolean;
  type: (typeof questions.$inferSelect)["type"];
};

export const Card = ({
  text,
  imageSrc,
  audioSrc,
  shortcut,
  selected,
  onClick,
  status,
  disabled,
  type,
}: CardProps) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [audio, _, controls] = useAudio({ src: audioSrc || "" });

  const handleClick = useCallback(() => {
    if (disabled) return;

    void controls.play();
    onClick();
  }, [disabled, onClick, controls]);

  useKey(shortcut, handleClick, {}, [handleClick]);

  return (
    <div
      onClick={handleClick}
      className={cn(
        "h-full cursor-pointer rounded-xl border-2 border-b-4 p-4 hover:bg-black/5 active:border-b-2 lg:p-6",
        selected && "border-brand bg-brand-50 hover:bg-brand-50",
        selected &&
          status === "correct" &&
          "border-success bg-success-50 hover:bg-success-50",
        selected &&
          status === "wrong" &&
          "border-danger bg-danger-50 hover:bg-danger-50",
        disabled && "pointer-events-none hover:bg-surface",
        type === "ASSIST" && "w-full lg:p-3"
      )}
    >
      {audio}
      {imageSrc && (
        <div className="relative mb-4 aspect-square max-h-[80px] w-full lg:max-h-[150px]">
          <Image src={imageSrc} fill alt={text} />
        </div>
      )}

      <div
        className={cn(
          "flex items-center justify-between",
          type === "ASSIST" && "flex-row-reverse"
        )}
      >
        {type === "ASSIST" && <div aria-hidden />}
        <p
          className={cn(
            "text-base font-medium text-ink-3 lg:text-lg",
            selected && "text-brand",
            selected && status === "correct" && "text-success",
            selected && status === "wrong" && "text-danger"
          )}
        >
          {text}
        </p>

        <div
          className={cn(
            // Keyboard-shortcut hint: desktop only — pure noise on the
            // touch-first crew view.
            "hidden h-[20px] w-[20px] items-center justify-center rounded-lg border-2 text-xs font-semibold text-neutral-400 lg:flex lg:h-[30px] lg:w-[30px] lg:text-[15px]",
            selected && "border-brand text-brand",
            selected &&
              status === "correct" &&
              "border-success text-success",
            selected && status === "wrong" && "border-danger text-danger"
          )}
        >
          {shortcut}
        </div>
      </div>
    </div>
  );
};
