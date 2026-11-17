import { useState } from "react";
import { badgePermission, requestBadgePermission, type BadgePermission } from "@/app/badge.ts";
import { setPreferences, usePreferences } from "@/data/preferences";
import { useT } from "@/i18n/index.tsx";
import { ListSection } from "@/ui/ListRow.tsx";
import { Switch } from "@/ui/Switch.tsx";
import styles from "../Settings.module.css";

export function BadgeSection() {
  const t = useT();
  const { unreadBadge } = usePreferences();
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState<BadgePermission | null>(null);
  // Permission may be revoked after enabling.
  const permission = requested ?? (unreadBadge ? badgePermission() : null);

  const enable = () => {
    setRequesting(true);
    requestBadgePermission().then(
      (result) => {
        setRequesting(false);
        setRequested(result);
        if (result === "granted") setPreferences({ unreadBadge: true });
      },
      () => {
        setRequesting(false);
        setRequested("denied");
      },
    );
  };

  return (
    <ListSection footer={t("settings.badge.footer")}>
      <li className={styles.control}>
        <Switch
          isSelected={unreadBadge || requesting}
          isDisabled={requesting}
          onChange={(on) => {
            if (on) enable();
            else {
              setRequested(null);
              setPreferences({ unreadBadge: false });
            }
          }}
        >
          {t("settings.badge.toggle")}
        </Switch>
        {permission === "denied" ? (
          <p role="alert" className={styles.alert}>
            {t("app.badge.denied")}
          </p>
        ) : null}
        {permission === "unsupported" ? (
          <p role="alert" className={styles.alert}>
            {t("app.badge.unsupported")}
          </p>
        ) : null}
      </li>
    </ListSection>
  );
}
