"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { upsertImageProviderSettings, type ImageProviderView } from "@/features/platform/actions";
import { Button } from "@/shared/ui/button";

const inputClass =
  "w-full rounded-xl border-2 px-4 py-2 outline-none focus:border-green-500";

/**
 * Image model config (AI Course Builder). A SEPARATE provider from the text
 * model — the course builder generates lesson art + course icons here. Any
 * OpenAI-compatible images endpoint works (we POST {baseUrl}/images/generations).
 */
export const ImageProviderForm = ({ current }: { current: ImageProviderView }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [baseUrl, setBaseUrl] = useState(current.baseUrl);
  const [model, setModel] = useState(current.model);
  const [apiKey, setApiKey] = useState("");

  const submit = () => {
    startTransition(async () => {
      const result = await upsertImageProviderSettings({
        baseUrl,
        model,
        apiKey: apiKey || undefined,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setApiKey("");
      toast.success("Image model saved.");
      router.refresh();
    });
  };

  return (
    <form
      className="flex max-w-xl flex-col gap-y-4 rounded-2xl border-2 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">Base URL</label>
        <input
          className={inputClass}
          placeholder="https://api.openai.com/v1"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          OpenAI-compatible images endpoint. We call {"{baseUrl}"}/images/generations.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">Model</label>
        <input
          className={inputClass}
          placeholder="e.g. gpt-image-1"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-neutral-700">
          API key{" "}
          {current.hasKey && (
            <span className="font-normal text-muted-foreground">
              (saved — leave blank to keep it)
            </span>
          )}
        </label>
        <input
          className={inputClass}
          type="password"
          placeholder={current.hasKey ? "••••••••" : "sk-…"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
        />
      </div>

      <Button type="submit" variant="secondary" size="lg" disabled={pending}>
        Save image model
      </Button>
    </form>
  );
};
