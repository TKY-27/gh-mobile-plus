import { isGitHubError, orgApprovalUrl, type GitHubError } from "@/data/errors";
import type { Translate } from "@/i18n/index.tsx";
import { openExternal } from "./external.ts";
import { showToast } from "./Toast.tsx";

type OrgAccessRestricted = Extract<GitHubError, { kind: "orgAccessRestricted" }>;

export function isOrgAccessRestricted(error: unknown): error is OrgAccessRestricted {
  return isGitHubError(error) && error.kind === "orgAccessRestricted";
}

export function showOrgAccessRestrictedToast(
  t: Translate,
  error: OrgAccessRestricted,
  title = t("errors.orgAccessRestricted.title", { org: error.org }),
): void {
  const url = error.ssoUrl ?? orgApprovalUrl();
  showToast(`${title} ${t("errors.orgAccessRestricted.message")}`, {
    timeoutMs: null,
    action: {
      label: t(
        error.ssoUrl ? "errors.orgAccessRestricted.sso" : "errors.orgAccessRestricted.request",
      ),
      onAction: () => {
        openExternal(url);
      },
    },
  });
}

export function showErrorToast(
  t: Translate,
  error: unknown,
  message: string,
  retry?: () => void,
): void {
  if (isOrgAccessRestricted(error)) {
    showOrgAccessRestrictedToast(t, error);
    return;
  }
  showToast(message, retry ? { action: { label: t("common.retry"), onAction: retry } } : {});
}
