import { CircleAlert, Copy, RotateCcw } from "lucide-react";
import { errorDiagnostics, isGitHubError, orgApprovalUrl, type GitHubError } from "@/data/errors";
import { signInHref, useSession } from "@/data/session";
import { useFormatters, useT, type Formatters, type Translate } from "@/i18n/index.tsx";
import { Button } from "./Button.tsx";
import { useNow } from "./RelativeTime.tsx";
import { showToast } from "./Toast.tsx";
import styles from "./ErrorState.module.css";

export function isFullScreenError(error: GitHubError): boolean {
  return error.kind === "authExpired" || error.kind === "notFound";
}

export interface ErrorText {
  title: string;
  message: string;
}

export function describeError(
  t: Translate,
  formatters: Formatters,
  error: unknown,
  now: number,
): ErrorText {
  if (!isGitHubError(error)) {
    return { title: t("errors.unexpected.title"), message: t("errors.unexpected.message") };
  }
  return describeGitHubError(t, formatters, error, now);
}

function describeGitHubError(
  t: Translate,
  formatters: Formatters,
  error: GitHubError,
  now: number,
): ErrorText {
  switch (error.kind) {
    case "authExpired":
      return { title: t("errors.authExpired.title"), message: t("errors.authExpired.message") };
    case "orgAccessRestricted":
      return {
        title: t("errors.orgAccessRestricted.title", { org: error.org }),
        message: t("errors.orgAccessRestricted.message"),
      };
    case "rateLimited":
      return {
        title: t("errors.rateLimited.title"),
        message: t(
          error.secondary ? "errors.rateLimited.secondary" : "errors.rateLimited.message",
          {
            time: formatters.relativeTime(error.resetAt, now),
          },
        ),
      };
    case "notFound":
      return { title: t("errors.notFound.title"), message: t("errors.notFound.message") };
    case "forbidden":
      return { title: t("errors.forbidden.title"), message: t("errors.forbidden.message") };
    case "conflict":
      return { title: t("errors.conflict.title"), message: t("errors.conflict.message") };
    case "validation":
      return { title: t("errors.validation.title"), message: t("errors.validation.message") };
    case "network":
      return { title: t("errors.network.title"), message: t("errors.network.message") };
    case "server":
      return {
        title: t("errors.server.title"),
        message: t("errors.server.message", { status: String(error.status) }),
      };
  }
}

function ReauthButton() {
  const t = useT();
  const { activeAccount } = useSession();
  const href = signInHref({
    mode: "reauth",
    ...(activeAccount ? { accountId: activeAccount.id } : {}),
    publicOnly: activeAccount?.publicOnly ?? false,
  });
  return (
    <a className={styles.linkButton} href={href}>
      {t("errors.authExpired.action")}
    </a>
  );
}

export function ErrorState(props: { error: unknown; onRetry?: () => void; fullScreen?: boolean }) {
  const t = useT();
  const formatters = useFormatters();
  const now = useNow();
  const { error } = props;
  const text = describeError(t, formatters, error, now);
  const copyDetails = () => {
    navigator.clipboard.writeText(errorDiagnostics(error)).then(
      () => showToast(t("common.copied")),
      () => showToast(t("common.copyFailed")),
    );
  };
  return (
    <div role="alert" className={styles.error} data-full-screen={props.fullScreen || undefined}>
      <CircleAlert className={styles.icon} aria-hidden />
      <h2 className={styles.title}>{text.title}</h2>
      <p className={styles.message}>{text.message}</p>
      <div className={styles.actions}>
        {isGitHubError(error) && error.kind === "authExpired" ? <ReauthButton /> : null}
        {isGitHubError(error) && error.kind === "orgAccessRestricted" ? (
          <a
            className={styles.linkButton}
            href={error.ssoUrl ?? orgApprovalUrl()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(
              error.ssoUrl
                ? "errors.orgAccessRestricted.sso"
                : "errors.orgAccessRestricted.request",
            )}
          </a>
        ) : null}
        {props.onRetry ? (
          <Button variant="primary" icon={<RotateCcw aria-hidden />} onPress={props.onRetry}>
            {t("common.retry")}
          </Button>
        ) : null}
        <Button variant="plain" icon={<Copy aria-hidden />} onPress={copyDetails}>
          {t("common.copyDetails")}
        </Button>
      </div>
    </div>
  );
}
