import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "./Button.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./Toast.module.css";

export const TOAST_TIMEOUT_MS = 5000;

export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface QueuedToast {
  id: number;
  message: string;
  action: ToastAction | null;
  timeoutMs: number | null | "request";
}

let queue: readonly QueuedToast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const remainingTime = new WeakMap<QueuedToast, number>();

function setQueue(next: readonly QueuedToast[]) {
  queue = next;
  for (const listener of listeners) listener();
}

export function dismissToast(id: number): void {
  setQueue(queue.filter((toast) => toast.id !== id));
}

export function showToast(
  message: string,
  options: { action?: ToastAction; timeoutMs?: QueuedToast["timeoutMs"] } = {},
): number {
  const id = nextId++;
  const timeoutMs = options.timeoutMs === undefined ? TOAST_TIMEOUT_MS : options.timeoutMs;
  const toast = { id, message, action: options.action ?? null, timeoutMs };
  setQueue([...queue, toast]);
  return id;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
  };
}

export function ToastRegion() {
  const t = useT();
  const toast = useSyncExternalStore(
    subscribe,
    () => queue.find((entry) => entry.timeoutMs === "request") ?? queue.at(-1),
  );
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
  );
  // Removed buttons never blur; pause per toast.
  const [pausedId, setPausedId] = useState<number | null>(null);
  if (pausedId !== null && pausedId !== toast?.id) setPausedId(null);
  const paused = toast !== undefined && pausedId === toast.id;
  const pause = () => {
    setPausedId(toast?.id ?? null);
  };
  const resume = () => {
    setPausedId(null);
  };

  useEffect(() => {
    if (!toast || typeof toast.timeoutMs !== "number" || paused || !visible) return;
    const remaining = remainingTime.get(toast) ?? toast.timeoutMs;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => {
      dismissToast(toast.id);
    }, remaining);
    return () => {
      window.clearTimeout(timer);
      remainingTime.set(toast, Math.max(0, remaining - (performance.now() - startedAt)));
    };
  }, [toast, paused, visible]);

  return (
    <section
      aria-label={t("common.notifications")}
      className={styles.region}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={(event) => {
        if (!(
          event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
        )) {
          resume();
        }
      }}
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        {toast ? (
          <div key={toast.id} className={styles.toast}>
            <p className={styles.message}>{toast.message}</p>
            {toast.action ? (
              <AriaButton
                className={moduleClass(styles.action)}
                onPress={() => {
                  toast.action?.onAction();
                  dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </AriaButton>
            ) : null}
            <IconButton
              label={t("common.dismiss")}
              onPress={() => {
                dismissToast(toast.id);
              }}
            >
              <X aria-hidden />
            </IconButton>
          </div>
        ) : null}
      </div>
    </section>
  );
}
