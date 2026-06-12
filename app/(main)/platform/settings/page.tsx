import { redirect } from "next/navigation";

import { getProviderSettingsView } from "@/actions/platform";
import { getSession } from "@/lib/auth/session";

import { ProviderForm } from "./provider-form";

const PlatformSettingsPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "platform") redirect("/learn");

  const result = await getProviderSettingsView();
  const current = result.ok
    ? result.data
    : { provider: null, endpoint: "", model: "", alertThresholdUsd: null, hasKey: false };

  return (
    <div className="px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-700">AI provider</h1>
        <p className="text-sm text-muted-foreground">
          Connect the model that drafts training and powers the reteach loop.
          Your key is encrypted before it&apos;s stored and never leaves the
          server.
        </p>
      </div>
      <ProviderForm current={current} />
    </div>
  );
};

export default PlatformSettingsPage;
