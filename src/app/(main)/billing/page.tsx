import { redirect } from "next/navigation";

import { getSession } from "@/features/auth/session";
import { getBillingStatus } from "@/features/billing/status";

import { BillingPanel } from "./billing-panel";

const BillingPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const status = await getBillingStatus();

  return (
    <div className="mx-auto max-w-[640px] px-4">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-700">Billing</h1>
        <p className="text-sm text-muted-foreground">
          CREWReadiness is $99/month after your 14-day free trial. Cancel
          anytime.
        </p>
      </div>
      <BillingPanel status={status} />
    </div>
  );
};

export default BillingPage;
