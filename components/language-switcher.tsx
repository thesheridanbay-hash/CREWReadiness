"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setMyLanguageAction } from "@/actions/auth";
import { SUPPORTED_LANGUAGES, languageLabel } from "@/lib/content/languages";

/**
 * Self-service content-language switcher (multi-language courses). Lives in the
 * sidebar footer so a crew member on a shared phone can read in their own
 * language. Writes their own user_progress.language; "" = inherit the company
 * primary. Hidden when only the primary language is available.
 */
export const LanguageSwitcher = ({
  current,
  primary,
}: {
  current: string | null;
  primary: string;
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

  return (
    <label className="flex flex-col gap-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-neutral-400">
        Language
      </span>
      <select
        aria-label="My course language"
        disabled={pending}
        value={selected}
        onChange={(event) => change(event.target.value)}
        className="w-full rounded-xl border-2 px-3 py-1.5 text-sm font-medium text-neutral-600 outline-none focus:border-green-500 disabled:opacity-50"
      >
        <option value="">Default · {languageLabel(primary)}</option>
        {others.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  );
};
