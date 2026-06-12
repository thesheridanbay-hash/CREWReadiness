import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { getCrewRoster } from "@/lib/content/crew-queries";

import { CrewManager } from "./crew-manager";

const CrewPage = async () => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.role === "employee") redirect("/learn");

  const { members, invites } = await getCrewRoster();

  return (
    <div className="px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-700">Crew</h1>
        <p className="text-sm text-muted-foreground">
          Invite field employees. They sign in with a username + PIN on any
          phone — no email needed.
        </p>
      </div>
      <CrewManager members={members} invites={invites} />
    </div>
  );
};

export default CrewPage;
