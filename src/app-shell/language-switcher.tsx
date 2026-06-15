"use client";

import { useState, useTransition } from "react";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setMyLanguageAction } from "@/features/auth/actions";
import {
  SUPPORTED_LANGUAGES,
  languageFlag,
  languageLabel,
} from "@/features/courses/languages";

/**
 * Self-service content-language switcher (multi-language courses). Lives in the
 * Learn (course-taking) area so a crew member can read in their own language
 * right where they study. Writes their own user_progress.language; "" = inherit
 * the company primary. Hidden when only the primary language is available.
 *
 * `compact` (the Learn header) renders a small FLAG button + dropdown so it
 * doesn't crowd the course title; the labeled variant keeps a native select.
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
  const [open, setOpen] = useState(false);

  const others = SUPPORTED_LANGUAGES.filter((l) => l.code !== primary);
  if (others.length === 0) return null;

  // An explicit pref equal to the primary is shown as "Default".
  const selected = current && current !== primary ? current : "";
  const activeCode = selected || primary;

  const change = (language: string) => {
    setOpen(false);
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

  if (compact) {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="Change language"
          disabled={pending}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-x-1 rounded-xl border-2 px-2.5 py-1.5 text-lg leading-none outline-none hover:bg-canvas-2 focus:border-brand disabled:opacity-50"
        >
          <span aria-hidden>{languageFlag(activeCode)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
        </button>
        {open && (
          <>
            {/* Click-outside backdrop. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <ul className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border-2 bg-surface py-1 text-sm font-medium shadow-lg">
              <LangOption
                flag={languageFlag(primary)}
                label={`Default · ${languageLabel(primary)}`}
                active={selected === ""}
                onClick={() => change("")}
              />
              {others.map((language) => (
                <LangOption
                  key={language.code}
                  flag={language.flag}
                  label={language.label}
                  active={selected === language.code}
                  onClick={() => change(language.code)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

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

  return (
    <label className="flex flex-col gap-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-neutral-400">
        Language
      </span>
      {select}
    </label>
  );
};

const LangOption = ({
  flag,
  label,
  active,
  onClick,
}: {
  flag: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-x-2 px-3 py-2 text-left hover:bg-canvas-2 " +
        (active ? "text-brand" : "text-ink-3")
      }
    >
      <span aria-hidden className="text-base leading-none">
        {flag}
      </span>
      <span className="truncate">{label}</span>
    </button>
  </li>
);
