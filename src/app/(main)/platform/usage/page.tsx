import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/features/auth/session";
import { getPlatformUsage } from "@/features/ai/usage-queries";

const PlatformUsagePage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "platform") redirect("/learn");

  const rows = await getPlatformUsage();
  const total = rows.reduce((sum, row) => sum + row.monthSpendUsd, 0);

  return (
    <div className="px-4">
      <Link
        href="/platform/settings"
        className="text-sm font-bold text-info hover:underline"
      >
        ← AI settings
      </Link>
      <h1 className="my-4 text-2xl font-bold text-ink">
        Cross-company AI usage
      </h1>
      <p className="mb-6 text-3xl font-bold text-ink">
        ${total.toFixed(2)}{" "}
        <span className="text-sm font-medium text-muted-foreground">
          this month, all companies
        </span>
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AI usage yet this month.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border-2">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas-2 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Company</th>
                <th className="p-3 text-right">Calls</th>
                <th className="p-3 text-right">Spend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.companyId} className="border-t">
                  <td className="p-3 font-mono text-xs text-muted-foreground">
                    {row.companyId}
                  </td>
                  <td className="p-3 text-right">{row.calls}</td>
                  <td className="p-3 text-right font-bold">
                    ${row.monthSpendUsd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PlatformUsagePage;
