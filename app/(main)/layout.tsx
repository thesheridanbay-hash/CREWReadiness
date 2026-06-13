import type { PropsWithChildren } from "react";

import { BillingGate } from "@/features/billing/ui/billing-gate";
import { MobileHeader } from "@/app-shell/mobile-header";
import { Sidebar } from "@/app-shell/sidebar";
import { getSession } from "@/lib/auth/session";
import { getBillingStatus, isOwnerBlocked } from "@/features/billing/status";

const MainLayout = async ({ children }: PropsWithChildren) => {
  const session = await getSession();
  const billing = await getBillingStatus();
  const blocked = isOwnerBlocked(session?.role, billing);

  return (
    <>
      <MobileHeader />
      <Sidebar className="hidden lg:flex" />
      <main className="h-full pt-[50px] lg:pl-[256px] lg:pt-0">
        <div className="mx-auto h-full max-w-[1056px] pt-6">
          <BillingGate blocked={blocked}>{children}</BillingGate>
        </div>
      </main>
    </>
  );
};

export default MainLayout;
