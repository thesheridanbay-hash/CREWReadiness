"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { adoptListing } from "@/features/marketplace/actions";
import { Button } from "@/shared/ui/button";

/**
 * Adopt a listing into the current company (course marketplace). Calls the
 * server action, then drops the owner into the new draft course in the Studio.
 */
export const AdoptButton = ({
  listingId,
  alreadyAdopted,
}: {
  listingId: string;
  alreadyAdopted: boolean;
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const adopt = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await adoptListing({ listingId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        result.data.duplicate
          ? "Adopted again — a fresh copy is in your Studio."
          : "Adopted! Opening it in your Studio."
      );
      router.push(`/studio/${result.data.courseId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-y-1">
      <Button variant="secondary" disabled={busy} onClick={adopt}>
        {busy ? "Adopting…" : "Adopt into my company"}
      </Button>
      {alreadyAdopted && (
        <span className="text-xs text-muted-foreground">
          You&apos;ve adopted this before — adopting again makes another copy.
        </span>
      )}
    </div>
  );
};
