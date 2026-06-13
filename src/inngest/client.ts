import { Inngest } from "inngest";

/**
 * Inngest client (T6 — D6/D20).
 *
 * Events carry ONLY the job id — tenant identity is resolved inside handlers
 * via scopedForJob() from the DB-verified ai_jobs row, never from payloads
 * (outside-voice F2).
 */

export const EVENTS = {
  textRequested: "training/text.requested",
  voiceRequested: "training/voice.requested",
  photoRequested: "training/photo.requested",
  variantsRequested: "training/variants.requested",
  /** AI Course Builder: generate a full course draft from a brief. */
  courseRequested: "course/generate.requested",
  /** AI Course Builder: drain a course's image queue sequentially. */
  courseAssetsRequested: "course/assets.requested",
} as const;

/** The only payload events are allowed to carry (D20/F2). */
export type JobEventData = { jobId: string };

export const jobIdFrom = (data: unknown): string => {
  const jobId = (data as JobEventData | undefined)?.jobId;
  if (!jobId || typeof jobId !== "string") {
    throw new Error("Event is missing the jobId payload.");
  }
  return jobId;
};

export const inngest = new Inngest({ id: "crewreadiness" });
