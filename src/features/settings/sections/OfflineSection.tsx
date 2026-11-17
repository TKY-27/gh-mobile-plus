import { setPreferences, usePreferences } from "@/data/preferences";
import { useT } from "@/i18n/index.tsx";
import { ListSection } from "@/ui/ListRow.tsx";
import { Switch } from "@/ui/Switch.tsx";
import styles from "../Settings.module.css";

export function OfflineSection() {
  const t = useT();
  const { keepPrivateOffline } = usePreferences();
  return (
    <ListSection
      footer={t(keepPrivateOffline ? "settings.offline.footerOn" : "settings.offline.footerOff")}
    >
      <li className={styles.control}>
        <Switch
          isSelected={keepPrivateOffline}
          onChange={(on) => {
            setPreferences({ keepPrivateOffline: on });
          }}
        >
          {t("settings.offline.toggle")}
        </Switch>
      </li>
    </ListSection>
  );
}
