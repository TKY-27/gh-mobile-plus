import { useEffect, useId, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Modal } from "react-aria-components/Modal";
import { readSession, signOutAll } from "@/data/session";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { verifyLockCredential } from "./webauthn.ts";
import styles from "./AppLock.module.css";

const MAX_ATTEMPTS = 5;

export default function LockScreen(props: { credentialId: string; onUnlock: () => void }) {
  const t = useT();
  const [failures, setFailures] = useState(0);
  const [unlockError, setUnlockError] = useState<{ cause: unknown } | null>(null);
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const focusTitle = () => {
      title.current?.focus({ preventScroll: true });
    };
    if (document.visibilityState === "visible") {
      focusTitle();
      return;
    }
    document.addEventListener("visibilitychange", focusTitle, { once: true });
    return () => {
      document.removeEventListener("visibilitychange", focusTitle);
    };
  }, []);

  const unlock = () => {
    setPending(true);
    setUnlockError(null);
    verifyLockCredential(props.credentialId).then(
      () => {
        setPending(false);
        props.onUnlock();
      },
      (error: unknown) => {
        setPending(false);
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setFailures((count) => count + 1);
        } else {
          reportError(error);
          setUnlockError({ cause: error });
        }
      },
    );
  };

  return (
    <Modal isOpen isKeyboardDismissDisabled>
      <div className={styles.lock} role="dialog" aria-modal aria-labelledby={titleId}>
        <Lock className={styles.icon} aria-hidden />
        <h1 ref={title} id={titleId} className={styles.title} tabIndex={-1}>
          {t("app.lock.title")}
        </h1>
        {unlockError ? (
          <ErrorState error={unlockError.cause} />
        ) : (
          <p className={styles.message} aria-live="polite">
            {failures > 0 ? t("app.lock.failed", { count: failures }) : t("app.lock.message")}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="primary" wide isPending={pending} onPress={unlock}>
            {t("app.lock.unlock")}
          </Button>
          {failures >= MAX_ATTEMPTS ? (
            <Button
              variant="destructive"
              wide
              isPending={signingOut}
              onPress={() => {
                setSigningOut(true);
                setSignOutFailed(false);
                signOutAll().then(
                  () => {
                    setSigningOut(false);
                  },
                  () => {
                    setSigningOut(false);
                    const signedIn = readSession().accounts.some(
                      (account) => account.status === "active",
                    );
                    // Remote revocation retries after local sign-out.
                    if (signedIn) setSignOutFailed(true);
                    else showToast(t("settings.accounts.signedOutLocally"));
                  },
                );
              }}
            >
              {t("app.lock.signOutAll")}
            </Button>
          ) : null}
          {signOutFailed ? (
            <p role="alert" className={styles.message}>
              {t("app.lock.signOutFailed")}
            </p>
          ) : null}
        </div>
        <p className={styles.note}>{t("app.lock.privacyNote")}</p>
      </div>
    </Modal>
  );
}
