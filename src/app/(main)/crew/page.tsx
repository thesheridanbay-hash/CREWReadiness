import { redirect } from "next/navigation";

import { getSession } from "@/features/auth/session";
import { getCrewRoster } from "@/features/courses/crew-queries";

import { CrewManager } from "./crew-manager";

const CrewPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const { members, invites, primaryLanguage } = await getCrewRoster();

  return (
    <div className="px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-700">Crew</h1>
        <p className="text-sm text-muted-foreground">
          Invite field employees. They sign in with a username + PIN on any
          phone — no email needed.
        </p>
      </div>
      <CrewManager
        members={members}
        invites={invites}
        primaryLanguage={primaryLanguage}
      />
    </div>
  );
};

export default CrewPage;
