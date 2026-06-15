import { Loader } from "lucide-react";

/** Loading fallback while a lesson session starts/resumes (server). */
const Loading = () => {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center">
      <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
};

export default Loading;
