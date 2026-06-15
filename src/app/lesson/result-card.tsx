import Image from "next/image";

import { cn } from "@/shared/utils";

type ResultCardProps = {
  value: number;
  variant: "points";
};

export const ResultCard = ({ value, variant }: ResultCardProps) => {
  return (
    <div
      className={cn(
        "w-full max-w-xs rounded-2xl border-2",
        variant === "points" && "border-gold-500 bg-gold-500"
      )}
    >
      <div
        className={cn(
          "rounded-t-xl p-1.5 text-center text-xs font-bold uppercase text-brand-800",
          variant === "points" && "bg-gold-500"
        )}
      >
        Total XP
      </div>

      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-surface p-6 text-lg font-bold",
          variant === "points" && "text-gold-700"
        )}
      >
        <Image
          src="/points.svg"
          alt={variant}
          height={30}
          width={30}
          className="mr-1.5"
        />
        {value}
      </div>
    </div>
  );
};
