"use client";

import { use, useState, useTransition } from "react";

import { toast } from "sonner";

import { acceptEmployeeInviteAction } from "@/features/auth/actions";
import { Button } from "@/shared/ui/button";

const inputClass =
  "w-full rounded-xl border-2 px-4 py-3 text-base font-medium outline-none focus:border-brand";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

const InvitePage = ({ params }: InvitePageProps) => {
  const { token } = use(params);
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  const onSubmit = () => {
    if (pin !== confirm) {
      toast.error("PINs don't match.");
      return;
    }

    startTransition(() => {
      acceptEmployeeInviteAction({ inviteId: token, pin })
        .then((result) => {
          if (result && !result.ok) toast.error(result.error.message);
        })
        .catch(() => toast.error("Something went wrong. Please try again."));
    });
  };

  return (
    <form
      className="flex flex-col gap-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h2 className="text-center text-xl font-bold text-ink">
        Set your PIN
      </h2>
      <p className="text-center text-sm text-muted-foreground">
        Pick a 4-6 digit PIN. You&apos;ll use it with your username to sign in
        on any crew phone.
      </p>
      <input
        className={inputClass}
        placeholder="PIN (4-6 digits)"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        type="password"
        inputMode="numeric"
        maxLength={6}
        autoComplete="new-password"
      />
      <input
        className={inputClass}
        placeholder="Confirm PIN"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
        type="password"
        inputMode="numeric"
        maxLength={6}
        autoComplete="new-password"
      />
      <Button
        variant="secondary"
        size="lg"
        type="submit"
        disabled={pending || pin.length < 4 || confirm.length < 4}
      >
        Save PIN &amp; finish
      </Button>
    </form>
  );
};

export default InvitePage;
