"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createEmployeeInviteAction,
  resetEmployeePinAction,
  setCrewMemberLanguageAction,
} from "@/actions/auth";
import { Button } from "@/shared/ui/button";
import type { CrewMember, PendingInvite } from "@/lib/content/crew-queries";
import { SUPPORTED_LANGUAGES, languageLabel } from "@/lib/content/languages";

const inputClass =
  "w-full rounded-xl border-2 px-4 py-2 outline-none focus:border-green-500";

export const CrewManager = ({
  members,
  invites,
  primaryLanguage,
}: {
  members: CrewMember[];
  invites: PendingInvite[];
  primaryLanguage: string;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url);
    toast.success("Invite link copied.");
  };

  const invite = () => {
    startTransition(async () => {
      const result = await createEmployeeInviteAction({ username, displayName });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setUsername("");
      setDisplayName("");
      setLastLink(result.data.inviteUrl);
      copy(result.data.inviteUrl);
      router.refresh();
    });
  };

  const resetPin = (userId: string, pin: string) => {
    startTransition(async () => {
      const result = await resetEmployeePinAction({ targetUserId: userId, newPin: pin });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("PIN reset. Share the new PIN with them.");
      router.refresh();
    });
  };

  const setLanguage = (userId: string, language: string) => {
    startTransition(async () => {
      const result = await setCrewMemberLanguageAction({
        targetUserId: userId,
        language,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Language updated.");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-y-8">
      <form
        className="flex flex-col gap-3 rounded-2xl border-2 p-5 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (username.trim() && displayName.trim()) invite();
        }}
      >
        <div className="flex-1">
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Display name
          </label>
          <input
            className={inputClass}
            placeholder="Miguel"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Username
          </label>
          <input
            className={inputClass}
            placeholder="miguel"
            value={username}
            onChange={(event) =>
              setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))
            }
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || !username.trim() || !displayName.trim()}
        >
          Create invite
        </Button>
      </form>

      {lastLink && (
        <div className="flex items-center justify-between gap-x-3 rounded-xl border-2 border-green-300 bg-green-50 p-3 text-sm">
          <span className="break-all font-medium text-green-800">{lastLink}</span>
          <button
            type="button"
            onClick={() => copy(lastLink)}
            className="shrink-0 font-bold uppercase text-green-700 hover:underline"
          >
            Copy
          </button>
        </div>
      )}

      {invites.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Pending invites
          </h2>
          <div className="flex flex-col gap-y-2">
            {invites.map((inviteItem) => (
              <div
                key={inviteItem.id}
                className="flex items-center justify-between gap-x-3 rounded-xl border-2 p-3"
              >
                <span className="font-medium text-neutral-700">
                  {inviteItem.displayName}{" "}
                  <span className="text-muted-foreground">@{inviteItem.username}</span>
                </span>
                <button
                  type="button"
                  onClick={() => copy(inviteItem.url)}
                  className="text-xs font-bold uppercase text-sky-600 hover:underline"
                >
                  Copy link
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Crew members
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No crew yet — create an invite above.
          </p>
        ) : (
          <div className="flex flex-col gap-y-2">
            {members.map((member) => {
              // An explicit pref equal to the primary is shown as "Default".
              const selectedLanguage =
                member.language && member.language !== primaryLanguage
                  ? member.language
                  : "";
              return (
                <div
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 p-3"
                >
                  <span className="font-medium text-neutral-700">
                    {member.displayName}{" "}
                    <span className="text-muted-foreground">@{member.username}</span>
                    {member.locked && (
                      <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                        Locked
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-x-3">
                    <select
                      aria-label={`Course language for ${member.displayName}`}
                      disabled={pending}
                      value={selectedLanguage}
                      onChange={(event) =>
                        setLanguage(member.userId, event.target.value)
                      }
                      className="rounded-xl border-2 px-3 py-1.5 text-sm font-medium text-neutral-700 outline-none focus:border-green-500 disabled:opacity-50"
                    >
                      <option value="">
                        Default · {languageLabel(primaryLanguage)}
                      </option>
                      {SUPPORTED_LANGUAGES.filter(
                        (language) => language.code !== primaryLanguage
                      ).map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const pin = window.prompt(
                          `New PIN for ${member.displayName} (4-6 digits):`
                        );
                        if (pin && /^\d{4,6}$/.test(pin))
                          resetPin(member.userId, pin);
                        else if (pin) toast.error("PIN must be 4-6 digits.");
                      }}
                      className="text-xs font-bold uppercase text-amber-600 hover:underline disabled:opacity-50"
                    >
                      Reset PIN
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
