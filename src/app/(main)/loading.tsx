import { Loader } from "lucide-react";

/**
 * Route-group loading fallback (App Router Suspense). Shows during navigation
 * to any /(main) page that doesn't define its own loading.tsx — so switching
 * pages shows a spinner instead of a frozen jerk while the server renders.
 */
const Loading = () => {
  return (
    <div className="flex h-full w-full items-center justify-center py-24">
      <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
};

export default Loading;
