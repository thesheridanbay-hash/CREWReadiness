import Image from "next/image";
import type { PropsWithChildren } from "react";

const AuthLayout = ({ children }: PropsWithChildren) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-y-8 bg-neutral-50 px-4">
      <div className="flex items-center gap-x-3">
        <Image src="/logo.svg" alt="SonarCoach" height={48} width={48} />
        <h1 className="text-3xl font-extrabold tracking-wide">
          <span className="text-teal-600">Sonar</span>
          <span className="text-green-600">Coach</span>
        </h1>
      </div>
      <div className="w-full max-w-md rounded-2xl border-2 bg-white p-8">
        {children}
      </div>
    </div>
  );
};

export default AuthLayout;
