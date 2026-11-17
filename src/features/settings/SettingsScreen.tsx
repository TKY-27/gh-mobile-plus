import { BellDot, CircleHelp, HardDriveDownload, Info, Lock, Palette, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Page } from "@/app/Page.tsx";
import { SETTINGS_SECTIONS } from "@/app/settings-sections.ts";
import { usePreferences } from "@/data/preferences";
import { useT } from "@/i18n/index.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";

const ICONS: Readonly<Record<string, ReactNode>> = {
  "/settings/appearance": <Palette aria-hidden />,
  "/settings/accounts": <Users aria-hidden />,
  "/settings/lock": <Lock aria-hidden />,
  "/settings/notifications": <BellDot aria-hidden />,
  "/settings/offline": <HardDriveDownload aria-hidden />,
  "/settings/about": <Info aria-hidden />,
  "/settings/help": <CircleHelp aria-hidden />,
};

export default function SettingsScreen() {
  const t = useT();
  const preferences = usePreferences();
  const onOff = (on: boolean) => t(on ? "settings.on" : "settings.off");
  const details: Readonly<Record<string, string>> = {
    "/settings/lock": onOff(preferences.appLock.enabled),
    "/settings/notifications": onOff(preferences.unreadBadge),
  };
  return (
    <Page title={t("app.settings.root")} largeTitle openOnGitHub={false}>
      <ListSection>
        {SETTINGS_SECTIONS.filter((section) => section.path !== "/settings").map((section) => (
          <ListRow
            key={section.path}
            leading={ICONS[section.path]}
            title={t(section.label)}
            detail={details[section.path]}
            href={section.path}
          />
        ))}
      </ListSection>
    </Page>
  );
}
