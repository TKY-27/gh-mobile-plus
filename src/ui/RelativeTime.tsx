import { useSyncExternalStore } from "react";
import { useFormatters } from "@/i18n/index.tsx";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) now = Date.now();
  timer ??= window.setInterval(() => {
    now = Date.now();
    for (const each of listeners) each();
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}

export function RelativeTime(props: { date: string }) {
  const formatters = useFormatters();
  const current = useNow();
  const date = new Date(props.date);
  return (
    <time dateTime={props.date} title={formatters.dateTime(date)}>
      {formatters.relativeTime(date, current)}
    </time>
  );
}
