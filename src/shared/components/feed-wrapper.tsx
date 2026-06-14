import type { PropsWithChildren } from "react";

export const FeedWrapper = ({ children }: PropsWithChildren) => {
  // `min-w-0` is required: as a `flex-1` child its default `min-width: auto`
  // floors it at content min-width, so on mobile (sidebar hidden) the column
  // can't shrink to the viewport and the parent `flex-row-reverse` pushes the
  // overflow off the left edge. `min-w-0` lets it shrink and the content wraps.
  return <div className="relative top-0 min-w-0 flex-1 pb-10">{children}</div>;
};
