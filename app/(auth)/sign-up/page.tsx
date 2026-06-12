"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

const inputClass =
  "w-full rounded-xl border-2 px-4 py-3 text-base font-medium outline-none focus:border-green-500";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const SignUpPage = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = () => {
    startTransition(async () => {
      const signUp = await authClient.signUp.email({ email, password, name });

      if (signUp.error) {
        toast.error(signUp.error.message ?? "Could not create the account.");
        return;
      }

      const org = await authClient.organization.create({
        name: companyName,
        slug: slugify(companyName) || `company-${Date.now()}`,
      });

      if (org.error) {
        toast.error(org.error.message ?? "Could not create the company.");
        return;
      }

      if (org.data) {
        await authClient.organization.setActive({
          organizationId: org.data.id,
        });
      }

      router.push("/learn");
      router.refresh();
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
      <h2 className="text-center text-xl font-bold text-neutral-700">
        Create your company
      </h2>
      <input
        className={inputClass}
        placeholder="Company name"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        autoComplete="organization"
      />
      <input
        className={inputClass}
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
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
        placeholder="Password (8+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        autoComplete="new-password"
      />
      <Button
        variant="secondary"
        size="lg"
        type="submit"
        disabled={
          pending || !companyName || !name || !email || password.length < 8
        }
      >
        Create account
      </Button>
      <a
        href="/sign-in"
        className="text-center text-sm font-bold text-green-600 hover:underline"
      >
        Already have an account? Sign in
      </a>
    </form>
  );
};

export default SignUpPage;
