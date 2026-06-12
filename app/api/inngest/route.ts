import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { decayScan } from "@/inngest/functions/decay-scan";
import { photoToTraining } from "@/inngest/functions/photo-to-training";
import { textToTraining } from "@/inngest/functions/text-to-training";
import { variantPregen } from "@/inngest/functions/variant-pregen";
import { voiceToTraining } from "@/inngest/functions/voice-to-training";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    textToTraining,
    voiceToTraining,
    photoToTraining,
    variantPregen,
    decayScan,
  ],
});
