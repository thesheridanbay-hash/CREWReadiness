import type { PropsWithChildren } from "react";

import { Wordmark } from "@/shared/components/wordmark";

const AuthLayout = ({ children }: PropsWithChildren) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-y-8 bg-neutral-50 px-4">
      <Wordmark iconSize={48} textClass="text-3xl" />
      <div className="w-full max-w-md rounded-2xl border-2 bg-white p-8">
        {children}
      </div>
    </div>
  );
};

export default AuthLayout;
