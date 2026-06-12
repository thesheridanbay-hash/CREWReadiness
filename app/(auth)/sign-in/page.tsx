"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { employeeSignInAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

type Tab = "crew" | "office";

const inputClass =
  "w-full rounded-xl border-2 px-4 py-3 text-base font-medium outline-none focus:border-green-500";

const SignInPage = () => {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("crew");
  const [pending, startTransition] = useTransition();

  /* Crew (employee) fields */
  const [companyId, setCompanyId] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");

  /* Office (owner/manager) fields */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onCrewSignIn = () => {
    startTransition(() => {
      employeeSignInAction({ companyId, username, pin })
        .then((result) => {
          if (result && !result.ok) toast.error(result.error.message);
        })
        .catch(() => toast.error("Something went wrong. Please try again."));
    });
  };

  const onOfficeSignIn = () => {
    startTransition(async () => {
      const { error } = await authClient.signIn.email({ email, password });

      if (error) {
        toast.error(error.message ?? "Wrong email or password.");
        return;
      }

      router.push("/learn");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-y-6">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-100 p-1">
        {(
          [
            ["crew", "Crew member"],
            ["office", "Owner / Manager"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
              tab === value
                ? "bg-white text-green-600 shadow"
                : "text-neutral-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "crew" ? (
        <form
          className="flex flex-col gap-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onCrewSignIn();
          }}
        >
          <input
            className={inputClass}
            placeholder="Company code"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            autoComplete="organization"
          />
          <input
            className={inputClass}
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
          />
          <input
            className={inputClass}
            placeholder="PIN (4-6 digits)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="current-password"
          />
          <Button
            variant="secondary"
            size="lg"
            type="submit"
            disabled={pending || !companyId || !username || pin.length < 4}
          >
            Start training
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Your manager sends you an invite link to set your PIN. Locked out?
            Ask them for a PIN reset.
          </p>
        </form>
      ) : (
        <form
          className="flex flex-col gap-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onOfficeSignIn();
          }}
        >
          <input
            className={inputClass}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
          />
          <input
            className={inputClass}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
          />
          <Button
            variant="secondary"
            size="lg"
            type="submit"
            disabled={pending || !email || !password}
          >
            Sign in
          </Button>
          <a
            href="/sign-up"
            className="text-center text-sm font-bold text-green-600 hover:underline"
          >
            New company? Create an account
          </a>
        </form>
      )}
    </div>
  );
};

export default SignInPage;
