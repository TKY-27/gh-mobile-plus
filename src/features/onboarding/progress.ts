import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ghm-onboarding";

export type OnboardingStage = "welcome" | "setup" | "done";

const listeners = new Set<() => void>();

function read(): OnboardingStage {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "setup" || stored === "done" ? stored : "welcome";
}

let stage = read();

export function setOnboardingStage(next: OnboardingStage): void {
  stage = next;
  localStorage.setItem(STORAGE_KEY, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOnboardingStage(): OnboardingStage {
  return useSyncExternalStore(subscribe, () => stage);
}
