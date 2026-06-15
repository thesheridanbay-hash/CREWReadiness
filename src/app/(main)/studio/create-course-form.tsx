"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createCourse } from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";

export const CreateCourseForm = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");

  const onSubmit = () => {
    if (!title.trim()) return;
    startTransition(async () => {
      const result = await createCourse({ title });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setTitle("");
      toast.success("Course created.");
      router.push(`/studio/${result.data.id}`);
    });
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border-2 p-5 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex-1">
        <label className="mb-1 block text-sm font-bold text-ink">
          New course
        </label>
        <input
          className="w-full rounded-xl border-2 px-4 py-2 outline-none focus:border-brand"
          placeholder="e.g. Equipment Safety"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending || !title.trim()}>
        Create
      </Button>
    </form>
  );
};
