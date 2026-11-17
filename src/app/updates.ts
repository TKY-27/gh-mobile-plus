import { useEffect, useId, useSyncExternalStore } from "react";

const SERVICE_WORKER_URL = "/sw.js";

const activeComposers = new Set<string>();
const listeners = new Set<() => void>();
let composerCount = 0;

function notify() {
  composerCount = activeComposers.size;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Updates would interrupt composition.
export function useComposerActive(active: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    activeComposers.add(id);
    notify();
    return () => {
      activeComposers.delete(id);
      notify();
    };
  }, [active, id]);
}

export function useIsComposing(): boolean {
  return useSyncExternalStore(subscribe, () => composerCount > 0);
}

function activate(worker: ServiceWorker) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}

// Only reload with user consent.
export async function startServiceWorker(
  onUpdateReady: (apply: () => void) => void,
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  const offer = (worker: ServiceWorker) => {
    onUpdateReady(() => {
      activate(worker);
    });
  };
  if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        offer(installing);
      }
    });
  });
}
