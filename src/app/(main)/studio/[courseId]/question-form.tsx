"use client";

import { useState } from "react";

import { toast } from "sonner";

import { createQuestion, updateQuestion } from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";
import type { Result } from "@/shared/errors";

import { inputClass, type EditorOption, type EditorQuestion } from "./studio-editor-types";

export const QuestionForm = ({
  lessonId,
  editing,
  disabled,
  run,
  onDone,
}: {
  lessonId: number;
  editing?: EditorQuestion;
  disabled: boolean;
  run: (action: () => Promise<Result<unknown>>, success?: string) => void;
  onDone: () => void;
}) => {
  const [question, setQuestion] = useState(editing?.question ?? "");
  const [explanation, setExplanation] = useState(editing?.explanation ?? "");
  const [options, setOptions] = useState<EditorOption[]>(
    editing
      ? editing.options.map((o, i) => ({ id: i, text: o.text, correct: o.correct }))
      : [
          { id: 0, text: "", correct: true },
          { id: 1, text: "", correct: false },
        ]
  );

  const setOption = (index: number, patch: Partial<EditorOption>) =>
    setOptions((prev) =>
      prev.map((option, i) => (i === index ? { ...option, ...patch } : option))
    );

  const submit = () => {
    const cleaned = options
      .map((option) => ({ text: option.text.trim(), correct: option.correct }))
      .filter((option) => option.text.length > 0);

    if (!question.trim() || cleaned.length < 2) {
      toast.error("Add a question and at least two answer options.");
      return;
    }
    if (!cleaned.some((option) => option.correct)) {
      toast.error("Mark one option correct.");
      return;
    }

    run(
      () =>
        editing
          ? updateQuestion({
              questionId: editing.id,
              question,
              explanation: explanation || undefined,
              options: cleaned,
            })
          : createQuestion({
              lessonId,
              type: "SELECT",
              question,
              explanation: explanation || undefined,
              options: cleaned,
            }),
      editing ? "Question updated." : "Question added."
    );
    onDone();
  };

  return (
    <div className="mt-2 flex flex-col gap-y-2 rounded-lg border-2 border-sky-200 p-3">
      <input
        className={inputClass}
        placeholder="Question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <input
        className={inputClass}
        placeholder="Why the right answer matters (shown when they miss)"
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
      />
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-x-2">
          <input
            type="radio"
            name={`correct-${lessonId}`}
            checked={option.correct}
            onChange={() =>
              setOptions((prev) =>
                prev.map((o, i) => ({ ...o, correct: i === index }))
              )
            }
          />
          <input
            className={inputClass}
            placeholder={`Option ${index + 1}`}
            value={option.text}
            onChange={(event) => setOption(index, { text: event.target.value })}
          />
        </div>
      ))}
      <div className="flex items-center gap-x-2">
        {options.length < 6 && (
          <button
            type="button"
            onClick={() =>
              setOptions((prev) => [...prev, { id: prev.length, text: "", correct: false }])
            }
            className="text-xs font-bold uppercase text-sky-600 hover:underline"
          >
            + Option
          </button>
        )}
        <div className="flex-1" />
        <Button variant="secondary" disabled={disabled} onClick={submit}>
          Save
        </Button>
        <Button variant="default" disabled={disabled} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
};
