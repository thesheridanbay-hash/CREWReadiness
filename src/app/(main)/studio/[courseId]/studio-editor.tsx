"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  archiveCourse,
  createLesson,
  createModule,
  createUnit,
  deleteModule,
  deleteUnit,
  publishCourse,
} from "@/features/courses/actions/content";
import { Button } from "@/shared/ui/button";
import type { CourseAssetStatus } from "@/features/courses/actions/course-assets";
import type { CourseTranslationStatus } from "@/features/courses/actions/course-translate";
import type { CourseListingInfo } from "@/features/marketplace/actions";
import type {
  AssignTargets,
  CourseAssignmentRow,
} from "@/features/courses/assignment-queries";
import type { Result } from "@/shared/errors";

import { AssignPanel } from "./assign-panel";
import { GenerateImagesButton } from "./generate-images-button";
import { MarketplacePublishPanel } from "./marketplace-publish-panel";
import { TranslatePanel } from "./translate-panel";
import { LessonBlock } from "./lesson-block";
import { Row } from "./row";
import { inputClass, type EditorCourse } from "./studio-editor-types";

export type {
  EditorOption,
  EditorQuestion,
  EditorLessonImage,
  EditorLessonAudio,
  EditorLesson,
  EditorUnit,
  EditorModule,
  EditorCourse,
} from "./studio-editor-types";

export const StudioEditor = ({
  course,
  assetStatus,
  translationStatus,
  listing,
  isPlatform,
  assignTargets,
  courseAssignments,
}: {
  course: EditorCourse;
  assetStatus: CourseAssetStatus;
  translationStatus: CourseTranslationStatus;
  listing: CourseListingInfo;
  isPlatform: boolean;
  assignTargets: AssignTargets;
  courseAssignments: CourseAssignmentRow[];
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<Result<unknown>>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });

  return (
    <div className="mt-3">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-x-3">
          <h1 className="text-2xl font-bold text-ink">{course.title}</h1>
          <span
            className={
              course.published
                ? "rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-700"
                : "rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold text-gold-700"
            }
          >
            {course.published ? "Published" : "Draft"}
          </span>
        </div>
        <div className="flex items-center gap-x-2">
          <GenerateImagesButton courseId={course.id} status={assetStatus} />
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(
                () => publishCourse({ courseId: course.id }),
                "Published — your crew sees the latest version."
              )
            }
          >
            Publish
          </Button>
          <Button
            variant="dangerOutline"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Archive this course? It's hidden from your crew but you can restore it from Studio."
                )
              )
                return;
              startTransition(async () => {
                const result = await archiveCourse({ courseId: course.id });
                if (!result.ok) {
                  toast.error(result.error.message);
                  return;
                }
                toast.success("Course archived.");
                router.push("/studio");
              });
            }}
          >
            Archive
          </Button>
        </div>
      </div>

      <AssignPanel
        courseId={course.id}
        targets={assignTargets}
        current={courseAssignments}
      />

      <TranslatePanel courseId={course.id} status={translationStatus} />

      <MarketplacePublishPanel
        courseId={course.id}
        listing={listing}
        isPlatform={isPlatform}
      />

      <div className="flex flex-col gap-y-4">
        {course.modules.map((module) => (
          <section key={module.id} className="rounded-2xl border-2 p-4">
            <Row
              label={`Module: ${module.title}`}
              onDelete={() => run(() => deleteModule({ id: module.id }), "Module removed.")}
              disabled={pending}
            />

            <div className="ml-4 mt-3 flex flex-col gap-y-3 border-l-2 pl-4">
              {module.units.map((unit) => (
                <div key={unit.id}>
                  <Row
                    label={`Unit: ${unit.title}`}
                    onDelete={() => run(() => deleteUnit({ id: unit.id }), "Unit removed.")}
                    disabled={pending}
                  />
                  <div className="ml-4 mt-2 flex flex-col gap-y-2 border-l-2 pl-4">
                    {unit.lessons.map((lesson) => (
                      <LessonBlock
                        key={lesson.id}
                        courseId={course.id}
                        lesson={lesson}
                        disabled={pending}
                        run={run}
                      />
                    ))}
                    <InlineAdd
                      placeholder="Add lesson…"
                      disabled={pending}
                      onAdd={(title) =>
                        run(() => createLesson({ unitId: unit.id, title }))
                      }
                    />
                  </div>
                </div>
              ))}
              <InlineAdd
                placeholder="Add unit…"
                disabled={pending}
                onAdd={(title) => run(() => createUnit({ moduleId: module.id, title }))}
              />
            </div>
          </section>
        ))}

        <div className="rounded-2xl border-2 border-dashed p-4">
          <InlineAdd
            placeholder="Add module…"
            disabled={pending}
            onAdd={(title) => run(() => createModule({ courseId: course.id, title }))}
          />
        </div>
      </div>
    </div>
  );
};




const InlineAdd = ({
  placeholder,
  onAdd,
  disabled,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
  disabled: boolean;
}) => {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-x-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return;
        onAdd(value.trim());
        setValue("");
      }}
    >
      <input
        className={inputClass}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" variant="primaryOutline" disabled={disabled || !value.trim()}>
        Add
      </Button>
    </form>
  );
};
