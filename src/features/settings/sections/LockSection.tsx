import { useEffect, useState } from "react";
import { createLockCredential, isAppLockAvailable } from "@/app/lock/webauthn.ts";
import { setPreferences, usePreferences, type Preferences } from "@/data/preferences";
import { useT } from "@/i18n/index.tsx";
import { ListSection } from "@/ui/ListRow.tsx";
import { Switch } from "@/ui/Switch.tsx";
import styles from "../Settings.module.css";
import { ChoiceSection } from "./ChoiceSection.tsx";

type IdleMinutes = Preferences["appLock"]["idleMinutes"];
type Availability = "checking" | "available" | "unavailable";

const IDLE_CHOICES: readonly IdleMinutes[] = [1, 5, 15];

export function LockSection() {
  const t = useT();
  const { appLock } = usePreferences();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [registering, setRegistering] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    isAppLockAvailable().then(
      (available) => {
        setAvailability(available ? "available" : "unavailable");
      },
      () => {
        setAvailability("unavailable");
      },
    );
  }, []);

  const enable = () => {
    setRegistering(true);
    setFailed(false);
    createLockCredential().then(
      (credentialId) => {
        setRegistering(false);
        setPreferences({ appLock: { ...appLock, enabled: true, credentialId } });
      },
      () => {
        setRegistering(false);
        setFailed(true);
      },
    );
  };

  const unavailable = availability === "unavailable" && !appLock.enabled;
  return (
    <>
      <ListSection footer={t("app.lock.privacyNote")}>
        <li className={styles.control}>
          <Switch
            isSelected={appLock.enabled || registering}
            isDisabled={registering || availability === "checking" || unavailable}
            onChange={(on) => {
              if (on) enable();
              else setPreferences({ appLock: { ...appLock, enabled: false, credentialId: null } });
            }}
          >
            {t("settings.lock.toggle")}
          </Switch>
          {unavailable ? <p className={styles.note}>{t("settings.lock.unavailable")}</p> : null}
          {failed ? (
            <p role="alert" className={styles.alert}>
              {t("settings.lock.failed")}
            </p>
          ) : null}
        </li>
      </ListSection>
      <ChoiceSection
        title={t("settings.lock.idleTitle")}
        footer={t("settings.lock.idleFooter")}
        segments={IDLE_CHOICES.map((minutes) => ({
          id: String(minutes),
          label: t("settings.lock.minutes", { count: minutes }),
        }))}
        selected={String(appLock.idleMinutes)}
        onChange={(id) => {
          const idleMinutes = IDLE_CHOICES.find((minutes) => String(minutes) === id);
          if (idleMinutes !== undefined) setPreferences({ appLock: { ...appLock, idleMinutes } });
        }}
      />
    </>
  );
}
