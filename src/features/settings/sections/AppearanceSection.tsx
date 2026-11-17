import { setPreferences, usePreferences } from "@/data/preferences";
import { useT } from "@/i18n/index.tsx";
import { ChoiceSection } from "./ChoiceSection.tsx";

export function AppearanceSection() {
  const t = useT();
  const preferences = usePreferences();
  return (
    <>
      <ChoiceSection
        title={t("settings.language.title")}
        footer={t("settings.language.footer")}
        segments={[
          { id: "system", label: t("settings.followSystem") },
          { id: "en", label: t("settings.language.en") },
          { id: "ja", label: t("settings.language.ja") },
        ]}
        selected={preferences.language}
        onChange={(language) => {
          setPreferences({ language });
        }}
      />
      <ChoiceSection
        title={t("settings.theme.title")}
        footer={t("settings.theme.footer")}
        segments={[
          { id: "system", label: t("settings.followSystem") },
          { id: "light", label: t("settings.theme.light") },
          { id: "dark", label: t("settings.theme.dark") },
        ]}
        selected={preferences.theme}
        onChange={(theme) => {
          setPreferences({ theme });
        }}
      />
    </>
  );
}
