import { redirect } from "next/navigation";

import {
  getCourseBuilderSitePrompt,
  getImageProviderView,
  getProviderSettingsView,
} from "@/features/platform/actions";
import { getSession } from "@/features/auth/session";

import { ImageProviderForm } from "./image-form";
import { ProviderForm } from "./provider-form";
import { SitePromptForm } from "./site-prompt-form";

const PlatformSettingsPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "platform") redirect("/learn");

  const [textResult, imageResult, promptResult] = await Promise.all([
    getProviderSettingsView(),
    getImageProviderView(),
    getCourseBuilderSitePrompt(),
  ]);

  const current = textResult.ok
    ? textResult.data
    : {
        provider: null,
        endpoint: "",
        model: "",
        toolName: "ask_ai_hassan",
        alertThresholdUsd: null,
        hasKey: false,
      };
  const image = imageResult.ok ? imageResult.data : { baseUrl: "", model: "", hasKey: false };
  const sitePrompt = promptResult.ok ? promptResult.data : { sitePrompt: "" };

  return (
    <div className="flex flex-col gap-y-10 px-4 pb-10">
      <section>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-700">AI provider</h1>
          <p className="text-sm text-muted-foreground">
            Connect the model that drafts training and powers the reteach loop.
            Your key is encrypted before it&apos;s stored and never leaves the
            server.
          </p>
        </div>
        <ProviderForm current={current} />
      </section>

      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-neutral-700">Image model</h2>
          <p className="text-sm text-muted-foreground">
            Used by the AI Course Builder to generate lesson art and course
            icons — one image at a time. Leave this blank to use your connected
            OpenClaw (its generate_image tool) automatically; set a dedicated
            OpenAI-compatible endpoint here only to override it.
          </p>
        </div>
        <ImageProviderForm current={image} />
      </section>

      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-neutral-700">
            Course-builder guidance
          </h2>
          <p className="text-sm text-muted-foreground">
            Platform-wide house style for generated courses. Companies layer
            their own guidance on top.
          </p>
        </div>
        <SitePromptForm current={sitePrompt} />
      </section>
    </div>
  );
};

export default PlatformSettingsPage;
