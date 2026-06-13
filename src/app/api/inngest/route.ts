import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { decayScan } from "@/inngest/functions/decay-scan";
import { generateCourseAssets } from "@/inngest/functions/generate-course-assets";
import { generateCourseJob } from "@/inngest/functions/generate-course";
import { photoToTraining } from "@/inngest/functions/photo-to-training";
import { textToTraining } from "@/inngest/functions/text-to-training";
import { variantPregen } from "@/inngest/functions/variant-pregen";
import { voiceToTraining } from "@/inngest/functions/voice-to-training";

/**
 * Each Inngest step runs in its own invocation of this route, so the cap is
 * per-step, not per-job. 60s (the Vercel free-tier max) gives one image
 * generation room to finish; the sequential pipeline spreads N images across N
 * invocations. A provider slower than this fails the step and Inngest retries.
 */
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    textToTraining,
    voiceToTraining,
    photoToTraining,
    variantPregen,
    decayScan,
    generateCourseJob,
    generateCourseAssets,
  ],
});
