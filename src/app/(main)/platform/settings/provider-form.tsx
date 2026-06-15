"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { upsertProviderSettings, type ProviderSettingsView } from "@/features/platform/actions";
import { Button } from "@/shared/ui/button";

const inputClass =
  "w-full rounded-xl border-2 px-4 py-2 outline-none focus:border-brand";

export const ProviderForm = ({ current }: { current: ProviderSettingsView }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [provider, setProvider] = useState<"openclaw" | "direct">(
    current.provider ?? "openclaw"
  );
  const [endpoint, setEndpoint] = useState(current.endpoint);
  const [model, setModel] = useState(current.model);
  const [toolName, setToolName] = useState(current.toolName || "ask_ai_hassan");
  const [apiKey, setApiKey] = useState("");
  const [threshold, setThreshold] = useState(
    current.alertThresholdUsd ? String(current.alertThresholdUsd) : ""
  );

  const submit = () => {
    startTransition(async () => {
      const result = await upsertProviderSettings({
        provider,
        endpoint,
        model: model || undefined,
        toolName: provider === "openclaw" ? toolName || undefined : undefined,
        apiKey: apiKey || undefined,
        alertThresholdUsd: threshold ? Number(threshold) : undefined,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setApiKey("");
      toast.success("AI provider saved.");
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
        <label className="mb-1 block text-sm font-bold text-ink">Provider</label>
        <select
          className={inputClass}
          value={provider}
          onChange={(event) => setProvider(event.target.value as "openclaw" | "direct")}
        >
          <option value="openclaw">OpenClaw (MCP endpoint)</option>
          <option value="direct">Direct API (OpenAI-compatible)</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-ink">
          {provider === "openclaw" ? "MCP endpoint URL" : "Base URL"}
        </label>
        <input
          className={inputClass}
          placeholder="https://…/v1"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-ink">
          Model{" "}
          {provider === "openclaw" && (
            <span className="font-normal text-muted-foreground">(optional)</span>
          )}
        </label>
        <input
          className={inputClass}
          placeholder={provider === "openclaw" ? "leave blank for the bridge default" : "e.g. gpt-4o-mini"}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      </div>

      {provider === "openclaw" && (
        <div>
          <label className="mb-1 block text-sm font-bold text-ink">
            MCP generation tool
          </label>
          <input
            className={inputClass}
            placeholder="ask_ai_hassan"
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The tool your MCP server exposes for text generation (discovered:
            ask_ai_hassan).
          </p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-bold text-ink">
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

      <div>
        <label className="mb-1 block text-sm font-bold text-ink">
          Monthly cost alert (USD, optional)
        </label>
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="e.g. 50"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value.replace(/[^\d.]/g, ""))}
        />
      </div>

      <Button type="submit" variant="secondary" size="lg" disabled={pending}>
        Save provider
      </Button>
    </form>
  );
};
