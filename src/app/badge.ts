import { useEffect } from "react";
import { usePreferences } from "@/data/preferences";

export type BadgePermission = "granted" | "denied" | "unsupported";

function supportsBadge(): boolean {
  return "setAppBadge" in window.navigator && "Notification" in window;
}

export function badgePermission(): BadgePermission {
  if (!supportsBadge()) return "unsupported";
  return Notification.permission === "granted" ? "granted" : "denied";
}

// iOS gates badges on notification permission.
export async function requestBadgePermission(): Promise<BadgePermission> {
  if (!supportsBadge()) return "unsupported";
  const result = await Notification.requestPermission();
  return result === "granted" ? "granted" : "denied";
}

function reportBadgeFailure(error: unknown): void {
  console.error("App badge update failed", error);
}

export function useAppBadge(count: number | null): void {
  const { unreadBadge } = usePreferences();
  useEffect(() => {
    if (!supportsBadge()) return;
    if (!unreadBadge || count === 0) {
      navigator.clearAppBadge().catch(reportBadgeFailure);
      return;
    }
    if (count === null || badgePermission() !== "granted") return;
    navigator.setAppBadge(count).catch(reportBadgeFailure);
  }, [unreadBadge, count]);
}
