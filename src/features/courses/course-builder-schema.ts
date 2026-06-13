import { z } from "zod";

/**
 * AI Course Builder generation input. Lives outside the "use server" action
 * module so it can be imported by tests and forms (server-action files may
 * only export async functions). `brief` params are trusted guidance; the
 * free-text `userBrief` is sandwiched as DATA in the prompt.
 */
export const courseBuilderInputSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    unitCount: z.number().int().min(1).max(20).optional(),
    goals: z.string().trim().max(2000).optional(),
    topics: z.string().trim().max(2000).optional(),
    employeeLevel: z.string().trim().max(200).optional(),
    style: z.string().trim().max(200).optional(),
    userBrief: z.string().trim().max(5000).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.userBrief || value.title || value.topics || value.goals),
    { message: "Describe the course — add an idea, a title, topics, or goals." }
  );

export type CourseBuilderInput = z.infer<typeof courseBuilderInputSchema>;
