"use client";

import { useState } from "react";

import { AiCourseWizard } from "./ai-course-wizard";
import { CreateCourseForm } from "./create-course-form";

/**
 * Course creation entry (reference item 3): manual creation and AI generation
 * side by side. Manual is the default so the existing flow is untouched; AI is
 * the productivity accelerator, not a replacement.
 */

type Mode = "manual" | "ai";

const tabClass = (active: boolean) =>
  [
    "rounded-xl px-4 py-2 text-sm font-bold transition",
    active
      ? "bg-brand text-primary-foreground"
      : "border-2 text-ink-3 hover:bg-canvas-2",
  ].join(" ");

export const CourseCreator = () => {
  const [mode, setMode] = useState<Mode>("manual");

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex gap-x-2">
        <button type="button" className={tabClass(mode === "manual")} onClick={() => setMode("manual")}>
          Create manually
        </button>
        <button type="button" className={tabClass(mode === "ai")} onClick={() => setMode("ai")}>
          Build with AI
        </button>
      </div>

      {mode === "manual" ? <CreateCourseForm /> : <AiCourseWizard />}
    </div>
  );
};
