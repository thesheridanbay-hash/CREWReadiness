"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setMyLanguageAction } from "@/features/auth/actions";
import { SUPPORTED_LANGUAGES, languageLabel } from "@/features/courses/languages";

/**
 * Self-service content-language switcher (multi-language courses). Lives in the
 * Learn (course-taking) area so a crew member can read in their own language
 * right where they study. Writes their own user_progress.language; "" = inherit
 * the company primary. Hidden when only the primary language is available.
 *
 * `compact` renders just the dropdown (for the Learn header); otherwise it
 * shows a labeled control.
 */
export const LanguageSwitcher = ({
  current,
  primary,
  compact = false,
}: {
  current: string | null;
  primary: string;
  compact?: boolean;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const others = SUPPORTED_LANGUAGES.filter((l) => l.code !== primary);
  if (others.length === 0) return null;

  // An explicit pref equal to the primary is shown as "Default".
  const selected = current && current !== primary ? current : "";

  const change = (language: string) => {
    startTransition(async () => {
      const result = await setMyLanguageAction({ language });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Language updated.");
      router.refresh();
    });
  };

  const select = (
    <select
      aria-label="My course language"
      disabled={pending}
      value={selected}
      onChange={(event) => change(event.target.value)}
      className="rounded-xl border-2 px-3 py-1.5 text-sm font-medium text-ink-3 outline-none focus:border-brand disabled:opacity-50"
    >
      <option value="">Default · {languageLabel(primary)}</option>
      {others.map((language) => (
        <option key={language.code} value={language.code}>
          {language.label}
        </option>
      ))}
    </select>
  );

  if (compact) return select;

  return (
    <label className="flex flex-col gap-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-neutral-400">
        Language
      </span>
      {select}
    </label>
  );
};
