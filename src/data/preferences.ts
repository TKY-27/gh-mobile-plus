import { useSyncExternalStore } from "react";
import { property } from "./internal/json";

export interface Preferences {
  language: "system" | "en" | "ja";
  theme: "system" | "light" | "dark";
  appLock: { enabled: boolean; credentialId: string | null; idleMinutes: 1 | 5 | 15 };
  unreadBadge: boolean;
  keepPrivateOffline: boolean;
  softWrap: boolean;
  hideWhitespace: boolean;
}

const STORAGE_KEY = "ghm-preferences";
const DEFAULT_PREFERENCES: Preferences = {
  language: "system",
  theme: "system",
  appLock: { enabled: false, credentialId: null, idleMinutes: 5 },
  unreadBadge: false,
  keepPrivateOffline: true,
  softWrap: true,
  hideWhitespace: false,
};

let current: Preferences | null = null;
const listeners = new Set<() => void>();

function oneOf<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.find((option) => option === value) ?? fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parse(stored: string | null): Preferences {
  if (stored === null) return DEFAULT_PREFERENCES;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch (error) {
    if (error instanceof SyntaxError) return DEFAULT_PREFERENCES;
    throw error;
  }
  const defaults = DEFAULT_PREFERENCES;
  const lock = property(raw, "appLock");
  const credentialId = property(lock, "credentialId");
  return {
    language: oneOf(["system", "en", "ja"], property(raw, "language"), defaults.language),
    theme: oneOf(["system", "light", "dark"], property(raw, "theme"), defaults.theme),
    appLock: {
      enabled: flag(property(lock, "enabled"), defaults.appLock.enabled),
      credentialId: typeof credentialId === "string" ? credentialId : null,
      idleMinutes: oneOf([1, 5, 15], property(lock, "idleMinutes"), defaults.appLock.idleMinutes),
    },
    unreadBadge: flag(property(raw, "unreadBadge"), defaults.unreadBadge),
    keepPrivateOffline: flag(property(raw, "keepPrivateOffline"), defaults.keepPrivateOffline),
    softWrap: flag(property(raw, "softWrap"), defaults.softWrap),
    hideWhitespace: flag(property(raw, "hideWhitespace"), defaults.hideWhitespace),
  };
}

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

export function readPreferences(): Preferences {
  current ??= parse(localStorage.getItem(STORAGE_KEY));
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, readPreferences);
}

export function setPreferences(patch: Partial<Preferences>): void {
  current = { ...readPreferences(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  notify();
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  current = parse(event.newValue);
  notify();
});
