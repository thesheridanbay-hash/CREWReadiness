"use client";

import { useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";

type CourseOption = { id: number; title: string };

/**
 * Incident composer (go-live C): upload a job-site photo + note → the AI drafts
 * a short lesson → it lands in the review queue to approve & assign. Two-step
 * like the asset editor: upload the photo, then run the (synchronous) analyze.
 */
export const IncidentComposer = ({ courses }: { courses: CourseOption[] }) => {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [courseId, setCourseId] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Add a photo of the job-site issue first.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const up = await fetch("/api/media/upload?kind=PHOTO", {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      const upData = (await up.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!up.ok || !upData.id) {
        toast.error(upData.message ?? "Photo upload failed.");
        return;
      }

      const res = await fetch("/api/incident/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaAssetId: upData.id,
          note: note.trim() || undefined,
          courseId: courseId ? Number(courseId) : null,
        }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Couldn't turn that photo into a lesson.");
        return;
      }

      toast.success("Lesson drafted — review it, then assign it to your crew.");
      router.push("/studio/review");
    } catch {
      toast.error("That took too long — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 p-5">
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            Job-site photo
          </label>
          <div className="flex items-center gap-x-3">
            <Button
              variant="primaryOutline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {fileName ? "Change photo" : "Choose photo"}
            </Button>
            {fileName && (
              <span className="truncate text-sm text-muted-foreground">
                {fileName}
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              capture="environment"
              className="hidden"
              onChange={(event) =>
                setFileName(event.target.files?.[0]?.name ?? null)
              }
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-bold text-neutral-700">
            What happened? (optional)
          </label>
          <textarea
            className="min-h-20 w-full rounded-xl border-2 px-4 py-2 text-sm outline-none focus:border-green-500"
            placeholder="e.g. trimmer used without eye protection near the curb"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {courses.length > 0 && (
          <div>
            <label className="mb-1 block text-sm font-bold text-neutral-700">
              Add to course (optional)
            </label>
            <select
              value={courseId}
              disabled={busy}
              onChange={(event) => setCourseId(event.target.value)}
              className="rounded-xl border-2 px-3 py-1.5 text-sm font-medium text-neutral-700 outline-none focus:border-green-500 disabled:opacity-50"
            >
              <option value="">New standalone lesson</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-x-3">
          <Button variant="secondary" disabled={busy} onClick={generate}>
            {busy ? "Turning it into a lesson…" : "Make a lesson"}
          </Button>
          {busy && (
            <span className="text-xs text-muted-foreground">
              ~1–2 min — keep this open.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
