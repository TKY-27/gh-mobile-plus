import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import {
  MAX_ACCOUNTS,
  parseSignInError,
  signInHref,
  useSession,
  type SignInErrorCode,
} from "@/data/session";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { isIOS, isStandalone } from "./platform.ts";
import styles from "./SignInScreen.module.css";

const MARK_SIZE_PX = 72;

const ERROR_MESSAGES: Readonly<Record<SignInErrorCode, MessageKey>> = {
  state_mismatch: "app.signIn.error.stateMismatch",
  access_denied: "app.signIn.error.accessDenied",
  exchange_failed: "app.signIn.error.exchangeFailed",
  org_restricted: "app.signIn.error.orgRestricted",
  account_limit: "app.signIn.error.accountLimit",
};

export function SignInPanel(props: { onSignIn?: () => void }) {
  const t = useT();
  const search = useLocation({ select: (location) => location.searchStr });
  const error = parseSignInError(search);
  const [publicOnly, setPublicOnly] = useState(false);
  return (
    <div className={styles.panel}>
      {error ? (
        <p role="alert" className={styles.error}>
          <CircleAlert aria-hidden />
          <span>{t(ERROR_MESSAGES[error], { max: MAX_ACCOUNTS })}</span>
        </p>
      ) : null}
      <a
        className={styles.signIn}
        href={signInHref({ mode: "add", publicOnly })}
        onClick={props.onSignIn}
      >
        {t("app.signIn.action")}
      </a>
      <div className={styles.option}>
        <Switch isSelected={publicOnly} onChange={setPublicOnly}>
          {t("app.signIn.publicOnly")}
        </Switch>
        <p className={styles.hint}>{t("app.signIn.publicOnlyHint")}</p>
      </div>
      {isIOS && isStandalone() ? <p className={styles.hint}>{t("app.signIn.iosNote")}</p> : null}
    </div>
  );
}

export default function SignInScreen() {
  const t = useT();
  const { status } = useSession();
  return (
    <main className={styles.screen}>
      <img
        className={styles.mark}
        src="/icon.svg"
        alt=""
        width={MARK_SIZE_PX}
        height={MARK_SIZE_PX}
      />
      <h1 className={styles.title}>{t("app.title")}</h1>
      <p className={styles.subtitle}>{t("app.unofficial")}</p>
      <SignInPanel />
      {status === "ready" ? (
        <a className={styles.cancel} href="/">
          {t("common.cancel")}
        </a>
      ) : null}
    </main>
  );
}
