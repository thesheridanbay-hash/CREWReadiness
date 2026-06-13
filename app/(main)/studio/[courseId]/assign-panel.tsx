"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { assignCourse, unassignCourse } from "@/actions/assignments";
import { Button } from "@/shared/ui/button";
import type {
  AssignTargets,
  CourseAssignmentRow,
} from "@/lib/content/assignment-queries";

/**
 * Assign-this-course control in the editor (go-live A1). Owners pick a crew or
 * member, an optional due date, and required/optional, then assign. Existing
 * assignments list below with remove.
 */
export const AssignPanel = ({
  courseId,
  targets,
  current,
}: {
  courseId: number;
  targets: AssignTargets;
  current: CourseAssignmentRow[];
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Encoded target: "crew:<id>" | "user:<userId>".
  const [target, setTarget] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [required, setRequired] = useState(true);

  const noTargets =
    targets.crews.length === 0 && targets.members.length === 0;

  const assign = () => {
    if (!target) {
      toast.error("Pick a crew or member.");
      return;
    }
    const [kind, id] = target.split(":");
    startTransition(async () => {
      const result = await assignCourse({
        courseId,
        crewId: kind === "crew" ? Number(id) : undefined,
        userId: kind === "user" ? id : undefined,
        dueDate: dueDate ? dueDate : null,
        required,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(result.data.updated ? "Assignment updated." : "Assigned.");
      setTarget("");
      setDueDate("");
      router.refresh();
    });
  };

  const remove = (assignmentId: number) => {
    startTransition(async () => {
      const result = await unassignCourse({ assignmentId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Removed.");
      router.refresh();
    });
  };

  return (
    <section className="mb-6 rounded-2xl border-2 p-4">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Assign training
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Assign this course to a crew or a person, set a due date, and mark it
        required. Assigned courses show up on their Learn screen.
      </p>

      {noTargets ? (
        <p className="text-sm text-muted-foreground">
          Add crews or invite employees first (Crew page).
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-y-1">
            <span className="text-xs font-bold text-neutral-700">Who</span>
            <select
              value={target}
              disabled={pending}
              onChange={(event) => setTarget(event.target.value)}
              className="rounded-xl border-2 px-3 py-1.5 text-sm font-medium text-neutral-700 outline-none focus:border-green-500 disabled:opacity-50"
            >
              <option value="">Choose…</option>
              {targets.crews.length > 0 && (
                <optgroup label="Crews">
                  {targets.crews.map((crew) => (
                    <option key={`crew:${crew.id}`} value={`crew:${crew.id}`}>
                      {crew.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {targets.members.length > 0 && (
                <optgroup label="Members">
                  {targets.members.map((member) => (
                    <option
                      key={`user:${member.userId}`}
                      value={`user:${member.userId}`}
                    >
                      {member.displayName}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="flex flex-col gap-y-1">
            <span className="text-xs font-bold text-neutral-700">
              Due (optional)
            </span>
            <input
              type="date"
              value={dueDate}
              disabled={pending}
              onChange={(event) => setDueDate(event.target.value)}
              className="rounded-xl border-2 px-3 py-1.5 text-sm outline-none focus:border-green-500 disabled:opacity-50"
            />
          </label>
          <label className="flex items-center gap-x-2 pb-2">
            <input
              type="checkbox"
              checked={required}
              disabled={pending}
              onChange={(event) => setRequired(event.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium text-neutral-700">
              Required
            </span>
          </label>
          <Button variant="secondary" disabled={pending} onClick={assign}>
            Assign
          </Button>
        </div>
      )}

      {current.length > 0 && (
        <div className="mt-4 flex flex-col gap-y-2">
          {current.map((row) => (
            <div
              key={row.assignmentId}
              className="flex items-center justify-between gap-x-3 rounded-xl border-2 p-3"
            >
              <span className="text-sm font-medium text-neutral-700">
                {row.targetLabel}
                {row.required ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                    Required
                  </span>
                ) : (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                    Optional
                  </span>
                )}
                {row.dueDate && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    due {row.dueDate.toLocaleDateString()}
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(row.assignmentId)}
                className="text-xs font-bold uppercase text-rose-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
