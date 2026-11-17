import { Activity, lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { usePreferences } from "@/data/preferences";
import { MINUTE_MS } from "@/ui/time.ts";
import { recordLockActivity, setSessionVerification, wasVerifiedThisSession } from "./webauthn.ts";
import styles from "./AppLock.module.css";

const LockScreen = lazy(() => import("./LockScreen.tsx"));

function lockStateFor(credentialId: string | null, idleMs: number) {
  const verified =
    credentialId !== null &&
    document.visibilityState === "visible" &&
    wasVerifiedThisSession(credentialId, idleMs);
  return { credentialId, verified };
}

export function AppLock(props: { children: ReactNode }) {
  const { appLock } = usePreferences();
  const configuredCredentialId = appLock.enabled ? appLock.credentialId : null;
  const idleMs = appLock.idleMinutes * MINUTE_MS;
  const [lock, setLock] = useState(() => lockStateFor(configuredCredentialId, idleMs));
  if (lock.credentialId !== configuredCredentialId)
    setLock(lockStateFor(configuredCredentialId, idleMs));
  const hiddenAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const { credentialId, verified } = lock;
    if (credentialId === null) {
      setSessionVerification(null);
      hiddenAt.current = null;
      return;
    }
    const cover = () => {
      hiddenAt.current ??= Date.now();
      document.body.hidden = true;
      setSessionVerification(null);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cover();
        return;
      }
      document.body.hidden = false;
      const backgroundedAt = hiddenAt.current;
      hiddenAt.current = null;
      if (backgroundedAt === null || !verified) return;
      if (Date.now() - backgroundedAt < idleMs) {
        setSessionVerification(credentialId);
        return;
      }
      // Prevent a private frame on resume.
      flushSync(() => {
        setLock((current) => (current === lock ? { credentialId, verified: false } : current));
      });
    };
    if (document.visibilityState === "hidden") cover();
    else setSessionVerification(verified ? credentialId : null);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (verified && document.visibilityState === "visible") recordLockActivity();
      document.removeEventListener("visibilitychange", onVisibility);
      document.body.hidden = false;
    };
  }, [idleMs, lock]);

  const { credentialId, verified } = lock;
  const shielded = credentialId !== null && !verified;
  return (
    <>
      <Activity mode={shielded ? "hidden" : "visible"}>{props.children}</Activity>
      {shielded ? (
        <Suspense fallback={<div className={styles.lock} aria-hidden />}>
          <LockScreen
            key={credentialId}
            credentialId={credentialId}
            onUnlock={() => {
              setLock((current) => (current === lock ? { credentialId, verified: true } : current));
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
