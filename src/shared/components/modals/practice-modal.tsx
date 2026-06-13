"use client";

import Image from "next/image";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useIsClient } from "@/shared/use-is-client";
import { usePracticeModal } from "@/shared/store/use-practice-modal";

export const PracticeModal = () => {
  const isClient = useIsClient();
  const { isOpen, close } = usePracticeModal();

  if (!isClient) return null;

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-5 flex w-full items-center justify-center">
            <Image src="/points.svg" alt="Points" height={100} width={100} />
          </div>

          <DialogTitle className="text-center text-2xl font-bold">
            Practice lesson
          </DialogTitle>

          <DialogDescription className="text-center text-base">
            Use practice lessons to sharpen what you&apos;ve learned and earn
            extra points. You cannot lose points in practice lessons.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mb-4">
          <div className="flex w-full flex-col gap-y-4">
            <Button
              variant="primary"
              className="w-full"
              size="lg"
              onClick={close}
            >
              I understand
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
