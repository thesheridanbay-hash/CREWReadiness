"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * Hydration-safe "am I on the client?" hook. Returns false during SSR and the
 * first render, true after hydration — without setState-in-effect.
 */
export const useIsClient = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
