import type { MessageKey } from "@/i18n/index.tsx";

export const SETTINGS_SECTIONS: readonly { path: string; label: MessageKey }[] = [
  { path: "/settings", label: "app.settings.root" },
  { path: "/settings/appearance", label: "app.settings.appearance" },
  { path: "/settings/accounts", label: "app.settings.accounts" },
  { path: "/settings/lock", label: "app.settings.lock" },
  { path: "/settings/notifications", label: "app.settings.notifications" },
  { path: "/settings/offline", label: "app.settings.offline" },
  { path: "/settings/about", label: "app.settings.about" },
  { path: "/settings/help", label: "app.settings.help" },
];
