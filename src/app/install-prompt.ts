import { useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function publish(next: InstallPromptEvent | null) {
  deferred = next;
  for (const listener of listeners) listener();
}

// The event fires once, early.
window.addEventListener("beforeinstallprompt", (event) => {
  if (!isInstallPrompt(event)) return;
  event.preventDefault();
  publish(event);
});
window.addEventListener("appinstalled", () => {
  publish(null);
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallPrompt(): (() => Promise<void>) | null {
  const event = useSyncExternalStore(subscribe, () => deferred);
  if (!event) return null;
  return async () => {
    await event.prompt();
    publish(null);
  };
}
