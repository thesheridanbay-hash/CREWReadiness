import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/features/auth/session";
import { getRecentIncidents } from "@/features/courses/incident-queries";
import { getStudioCourses } from "@/features/courses/queries";

import { IncidentComposer } from "./incident-composer";

const IncidentsPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const [courses, recent] = await Promise.all([
    getStudioCourses(),
    getRecentIncidents(),
  ]);

  return (
    <div className="mx-auto max-w-[820px] px-4">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-700">Incidents</h1>
        <p className="text-sm text-muted-foreground">
          Snap a photo of a job-site mistake and turn it into a training lesson
          in about a minute. Review it, then assign it to your crew.
        </p>
      </div>

      <IncidentComposer
        courses={courses.map((c) => ({ id: c.id, title: c.title }))}
      />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Awaiting review
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting. Drafted lessons show up here until you approve them.
          </p>
        ) : (
          <div className="flex flex-col gap-y-2">
            {recent.map((incident) => (
              <Link
                key={incident.reviewItemId}
                href="/studio/review"
                className="flex items-center justify-between gap-x-3 rounded-xl border-2 p-3 transition hover:bg-slate-50"
              >
                <span className="font-medium text-neutral-700">
                  {incident.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {incident.createdAt.toLocaleDateString()} · Review →
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default IncidentsPage;
