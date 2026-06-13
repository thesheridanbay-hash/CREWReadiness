import { z } from "zod";

/**
 * Shared content-authoring schemas (T10 — D16). Hand-written per level (no
 * generic factory); actions and forms validate against the same shapes.
 * Display order is computed server-side (max+1), never trusted from input.
 */

const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500).optional();
const id = z.number().int().positive();

export const courseCreateSchema = z.object({
  title,
  imageSrc: z.string().trim().max(300).optional(),
});

export const courseUpdateSchema = z.object({
  courseId: id,
  title,
  imageSrc: z.string().trim().max(300).optional(),
});

export const moduleCreateSchema = z.object({
  courseId: id,
  title,
  description,
});

export const unitCreateSchema = z.object({
  moduleId: id,
  title,
  description,
});

export const lessonCreateSchema = z.object({
  unitId: id,
  title,
});

const optionSchema = z.object({
  text: z.string().trim().min(1).max(200),
  correct: z.boolean(),
});

export const questionCreateSchema = z
  .object({
    lessonId: id,
    type: z.enum(["SELECT", "ASSIST"]),
    question: z.string().trim().min(1).max(500),
    explanation: z.string().trim().max(1000).optional(),
    options: z.array(optionSchema).min(2).max(6),
  })
  .refine((value) => value.options.some((option) => option.correct), {
    message: "At least one option must be marked correct.",
    path: ["options"],
  });

export const questionUpdateSchema = z
  .object({
    questionId: id,
    question: z.string().trim().min(1).max(500),
    explanation: z.string().trim().max(1000).optional(),
    options: z.array(optionSchema).min(2).max(6),
  })
  .refine((value) => value.options.some((option) => option.correct), {
    message: "At least one option must be marked correct.",
    path: ["options"],
  });

export const idSchema = z.object({ id });
export const publishSchema = z.object({ courseId: id });

export type CourseCreateInput = z.infer<typeof courseCreateSchema>;
export type ModuleCreateInput = z.infer<typeof moduleCreateSchema>;
export type UnitCreateInput = z.infer<typeof unitCreateSchema>;
export type LessonCreateInput = z.infer<typeof lessonCreateSchema>;
export type QuestionCreateInput = z.infer<typeof questionCreateSchema>;
export type QuestionUpdateInput = z.infer<typeof questionUpdateSchema>;
