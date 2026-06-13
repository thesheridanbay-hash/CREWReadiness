import { redirect } from "next/navigation";

import { getSession } from "@/features/auth/session";
import { getCompanyUsage } from "@/features/ai/usage-queries";
import {
  getEmployeeProgress,
  getWeakConcepts,
} from "@/features/courses/reports-queries";

const ReportsPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const [weak, progress, usage] = await Promise.all([
    getWeakConcepts(),
    getEmployeeProgress(),
    getCompanyUsage(),
  ]);

  return (
    <div className="px-4 pb-16">
      <h1 className="mb-6 text-2xl font-bold text-neutral-700">Reports</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Weak concepts — most-missed questions
        </h2>
        {weak.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No misses logged yet. As your crew trains, the questions they
            struggle with rise to the top here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Question</th>
                  <th className="p-3">Lesson</th>
                  <th className="p-3 text-right">Miss rate</th>
                  <th className="p-3 text-right">Wrong / total</th>
                </tr>
              </thead>
              <tbody>
                {weak.map((row) => (
                  <tr key={row.questionId} className="border-t">
                    <td className="p-3 font-medium text-neutral-700">{row.question}</td>
                    <td className="p-3 text-muted-foreground">{row.lesson}</td>
                    <td className="p-3 text-right font-bold text-rose-600">
                      {row.missRate}%
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {row.wrong}/{row.attempts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Crew progress
        </h2>
        {progress.length === 0 ? (
          <p className="text-sm text-muted-foreground">No crew activity yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Crew member</th>
                  <th className="p-3 text-right">Questions mastered</th>
                  <th className="p-3 text-right">Attempts</th>
                  <th className="p-3 text-right">Needs coaching</th>
                </tr>
              </thead>
              <tbody>
                {progress.map((row) => (
                  <tr key={row.userId} className="border-t">
                    <td className="p-3 font-medium text-neutral-700">{row.name}</td>
                    <td className="p-3 text-right">{row.questionsMastered}</td>
                    <td className="p-3 text-right text-muted-foreground">
                      {row.totalAttempts}
                    </td>
                    <td className="p-3 text-right">
                      {row.parked > 0 ? (
                        <span className="font-bold text-amber-600">{row.parked}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          AI usage this month
        </h2>
        <div className="rounded-2xl border-2 p-5">
          <p className="text-3xl font-bold text-neutral-700">
            ${usage.monthSpendUsd.toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground">
            {usage.monthInputTokens.toLocaleString()} in /{" "}
            {usage.monthOutputTokens.toLocaleString()} out tokens
          </p>
          {usage.byOperation.length > 0 && (
            <ul className="mt-3 flex flex-col gap-y-1 text-sm">
              {usage.byOperation.map((op) => (
                <li key={op.operation} className="flex justify-between">
                  <span className="text-muted-foreground">{op.operation}</span>
                  <span className="font-medium">
                    {op.calls} calls · ${op.costUsd.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default ReportsPage;
