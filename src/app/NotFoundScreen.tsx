import { useT } from "@/i18n/index.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Page } from "./Page.tsx";

const NOT_FOUND = { kind: "notFound" } as const;

export function NotFoundScreen() {
  const t = useT();
  return (
    <Page title={t("errors.notFound.title")} openOnGitHub>
      <ErrorState error={NOT_FOUND} fullScreen />
    </Page>
  );
}
