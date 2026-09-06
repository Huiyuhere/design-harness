"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const serverZone = () => "UTC";
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// First hydration uses the same locale/timezone as SSR. Afterwards, use the
// viewer's timezone without a server/client text mismatch or discarded UI.
export function useDisplayDates() {
  const timeZone = useSyncExternalStore(subscribe, browserZone, serverZone);
  return {
    timeLabel: (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
    dateLabel: (value: string) => new Date(value).toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone }),
  };
}
