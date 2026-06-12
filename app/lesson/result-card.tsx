import Image from "next/image";

import { cn } from "@/lib/utils";

type ResultCardProps = {
  value: number;
  variant: "points";
};

export const ResultCard = ({ value, variant }: ResultCardProps) => {
  return (
    <div
      className={cn(
        "w-full max-w-xs rounded-2xl border-2",
        variant === "points" && "border-orange-400 bg-orange-400"
      )}
    >
      <div
        className={cn(
          "rounded-t-xl p-1.5 text-center text-xs font-bold uppercase text-white",
          variant === "points" && "bg-orange-400"
        )}
      >
        Total XP
      </div>

      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-white p-6 text-lg font-bold",
          variant === "points" && "text-orange-400"
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
