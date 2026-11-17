import { lazy, Suspense, type ReactNode } from "react";
import { NotFoundScreen } from "@/app/NotFoundScreen.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { settingsSectionRoute } from "@/app/router.ts";
import { SETTINGS_SECTIONS } from "@/app/settings-sections.ts";
import { useT } from "@/i18n/index.tsx";
import { AccountsSection } from "./sections/AccountsSection.tsx";
import { AppearanceSection } from "./sections/AppearanceSection.tsx";
import { BadgeSection } from "./sections/BadgeSection.tsx";
import { HelpSection } from "./sections/HelpSection.tsx";
import { LockSection } from "./sections/LockSection.tsx";
import { OfflineSection } from "./sections/OfflineSection.tsx";

// Licenses are large; only About loads them.
const AboutSection = lazy(() => import("./sections/AboutSection.tsx"));

const SECTION_BODIES: Readonly<Record<string, ReactNode>> = {
  "/settings/appearance": <AppearanceSection />,
  "/settings/accounts": <AccountsSection />,
  "/settings/lock": <LockSection />,
  "/settings/notifications": <BadgeSection />,
  "/settings/offline": <OfflineSection />,
  "/settings/about": (
    <Suspense fallback={<ScreenSkeleton />}>
      <AboutSection />
    </Suspense>
  ),
  "/settings/help": <HelpSection />,
};

export default function SettingsSectionScreen() {
  const t = useT();
  const { section } = useScreenParams(settingsSectionRoute);
  const path = `/settings/${section}`;
  const entry = SETTINGS_SECTIONS.find((each) => each.path === path);
  const body = SECTION_BODIES[path];
  if (!entry || body === undefined) return <NotFoundScreen />;
  return (
    <Page title={t(entry.label)} openOnGitHub={false}>
      {body}
    </Page>
  );
}
