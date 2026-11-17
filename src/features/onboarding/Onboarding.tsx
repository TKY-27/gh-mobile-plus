import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BellDot, Fingerprint, Smartphone } from "lucide-react";
import { setPreferences, usePreferences } from "@/data/preferences";
import { useT } from "@/i18n/index.tsx";
import { requestBadgePermission, type BadgePermission } from "@/app/badge.ts";
import { useInstallPrompt } from "@/app/install-prompt.ts";
import { createLockCredential, isAppLockAvailable } from "@/app/lock/webauthn.ts";
import { isIOS, isStandalone } from "@/app/platform.ts";
import { SignInPanel } from "@/app/SignInScreen.tsx";
import { Button } from "@/ui/Button.tsx";
import {
  AddToHomeIllustration,
  HomeScreenIllustration,
  ShareIllustration,
} from "./Illustrations.tsx";
import { setOnboardingStage } from "./progress.ts";
import styles from "./Onboarding.module.css";

const MARK_SIZE_PX = 88;

type Step = "welcome" | "install" | "signIn";

// Announce new steps to screen readers.
function StepTitle(props: { id: string; focusOnMount: boolean; children: ReactNode }) {
  const title = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (props.focusOnMount) title.current?.focus({ preventScroll: true });
  }, [props.focusOnMount]);
  return (
    <h1 ref={title} id={props.id} className={styles.title} tabIndex={-1}>
      {props.children}
    </h1>
  );
}

function Welcome(props: { onNext: () => void }) {
  const t = useT();
  const titleId = useId();
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <img
        className={styles.mark}
        src="/icon.svg"
        alt=""
        width={MARK_SIZE_PX}
        height={MARK_SIZE_PX}
      />
      <StepTitle id={titleId} focusOnMount={false}>
        {t("onboarding.welcome.title")}
      </StepTitle>
      <p className={styles.lead}>{t("onboarding.welcome.message")}</p>
      <p className={styles.note}>{t("app.unofficial")}</p>
      <div className={styles.actions}>
        <Button variant="primary" wide onPress={props.onNext}>
          {t("common.continue")}
        </Button>
      </div>
    </section>
  );
}

function InstallGuide(props: { onNext: () => void }) {
  const t = useT();
  const titleId = useId();
  const install = useInstallPrompt();
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <StepTitle id={titleId} focusOnMount={true}>
        {t("onboarding.install.title")}
      </StepTitle>
      <p className={styles.lead}>{t("onboarding.install.message")}</p>
      {isIOS ? (
        <ol className={styles.guide}>
          <li>
            <ShareIllustration />
            <span>{t("onboarding.install.ios.share")}</span>
          </li>
          <li>
            <AddToHomeIllustration />
            <span>{t("onboarding.install.ios.add")}</span>
          </li>
          <li>
            <HomeScreenIllustration />
            <span>{t("onboarding.install.ios.open")}</span>
          </li>
        </ol>
      ) : null}
      <div className={styles.actions}>
        {install ? (
          <Button
            variant="primary"
            wide
            icon={<Smartphone aria-hidden />}
            onPress={() => {
              install().then(props.onNext, (error: unknown) => {
                console.error("Install prompt failed", error);
                props.onNext();
              });
            }}
          >
            {t("onboarding.install.android")}
          </Button>
        ) : null}
        <Button variant={install ? "plain" : "primary"} wide onPress={props.onNext}>
          {t("onboarding.install.continueInBrowser")}
        </Button>
      </div>
    </section>
  );
}

function SignInStep() {
  const t = useT();
  const titleId = useId();
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <StepTitle id={titleId} focusOnMount={true}>
        {t("onboarding.signIn.title")}
      </StepTitle>
      <p className={styles.lead}>{t("onboarding.signIn.message")}</p>
      <SignInPanel
        onSignIn={() => {
          setOnboardingStage("setup");
        }}
      />
    </section>
  );
}

function Setup() {
  const t = useT();
  const titleId = useId();
  const preferences = usePreferences();
  const [lockAvailable, setLockAvailable] = useState(false);
  const [lockError, setLockError] = useState(false);
  const [badge, setBadge] = useState<BadgePermission | null>(null);

  useEffect(() => {
    isAppLockAvailable().then(setLockAvailable, () => {
      setLockAvailable(false);
    });
  }, []);

  const lockOn = preferences.appLock.enabled;
  return (
    <section className={styles.step} aria-labelledby={titleId}>
      <StepTitle id={titleId} focusOnMount={true}>
        {t("onboarding.setup.title")}
      </StepTitle>
      <p className={styles.lead}>{t("onboarding.setup.message")}</p>
      <div className={styles.option}>
        <Fingerprint className={styles.optionIcon} aria-hidden />
        <div>
          <h2 className={styles.optionTitle}>{t("onboarding.setup.lock.title")}</h2>
          <p className={styles.note}>{t("app.lock.privacyNote")}</p>
          {lockAvailable ? null : (
            <p className={styles.note}>{t("onboarding.setup.lock.unavailable")}</p>
          )}
          {lockError ? (
            <p role="alert" className={styles.error}>
              {t("onboarding.setup.lock.failed")}
            </p>
          ) : null}
        </div>
        <Button
          aria-label={lockOn ? t("onboarding.setup.lock.isOn") : t("onboarding.setup.lock.turnOn")}
          isDisabled={!lockAvailable || lockOn}
          onPress={() => {
            setLockError(false);
            createLockCredential().then(
              (credentialId) => {
                setPreferences({
                  appLock: { ...preferences.appLock, enabled: true, credentialId },
                });
              },
              () => {
                setLockError(true);
              },
            );
          }}
        >
          {lockOn ? t("onboarding.setup.on") : t("onboarding.setup.turnOn")}
        </Button>
      </div>
      <div className={styles.option}>
        <BellDot className={styles.optionIcon} aria-hidden />
        <div>
          <h2 className={styles.optionTitle}>{t("onboarding.setup.badge.title")}</h2>
          <p className={styles.note}>{t("onboarding.setup.badge.message")}</p>
          {badge === "denied" ? (
            <p role="alert" className={styles.error}>
              {t("app.badge.denied")}
            </p>
          ) : null}
          {badge === "unsupported" ? (
            <p role="alert" className={styles.error}>
              {t("app.badge.unsupported")}
            </p>
          ) : null}
        </div>
        <Button
          aria-label={
            preferences.unreadBadge
              ? t("onboarding.setup.badge.isOn")
              : t("onboarding.setup.badge.turnOn")
          }
          isDisabled={preferences.unreadBadge}
          onPress={() => {
            requestBadgePermission().then(
              (permission) => {
                setBadge(permission);
                if (permission === "granted") setPreferences({ unreadBadge: true });
              },
              () => {
                setBadge("denied");
              },
            );
          }}
        >
          {preferences.unreadBadge ? t("onboarding.setup.on") : t("onboarding.setup.turnOn")}
        </Button>
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          wide
          onPress={() => {
            setOnboardingStage("done");
          }}
        >
          {t("onboarding.setup.done")}
        </Button>
      </div>
    </section>
  );
}

export default function Onboarding(props: { mode: "intro" | "setup" }) {
  const [step, setStep] = useState<Step>("welcome");
  return (
    <main className={styles.onboarding}>
      {props.mode === "setup" ? (
        <Setup />
      ) : step === "welcome" ? (
        <Welcome
          onNext={() => {
            setStep(isStandalone() ? "signIn" : "install");
          }}
        />
      ) : step === "install" ? (
        <InstallGuide
          onNext={() => {
            setStep("signIn");
          }}
        />
      ) : (
        <SignInStep />
      )}
    </main>
  );
}
