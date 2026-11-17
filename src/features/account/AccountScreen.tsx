import { Settings, Users } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { useShell } from "@/app/shell-context.ts";
import { useActiveAccount } from "@/data/session";
import { useViewerOrganizations } from "@/data/users";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { ProfileView } from "./profile/ProfileView.tsx";
import styles from "./profile/Profile.module.css";

const ORG_AVATAR_PX = 28;
const ORG_SKELETON_ROWS = 2;

function Organizations() {
  const t = useT();
  const query = useViewerOrganizations();
  const title = t("account.organizations.title");
  if (query.isPending) {
    return (
      <ListSection title={title}>
        {Array.from({ length: ORG_SKELETON_ROWS }, (_, index) => (
          <li key={index} className={styles.inlineState} aria-hidden>
            <Skeleton width="60%" height="1.25rem" />
          </li>
        ))}
      </ListSection>
    );
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data.length === 0) {
    return (
      <ListSection title={title} footer={t("account.organizations.emptyHint")}>
        <li className={styles.inlineState}>{t("account.organizations.empty")}</li>
      </ListSection>
    );
  }
  return (
    <ListSection title={title} footer={t("account.organizations.missingHint")}>
      {query.data.map((organization) => (
        <ListRow
          key={organization.login}
          leading={
            <Avatar src={organization.avatarUrl} name={organization.login} size={ORG_AVATAR_PX} />
          }
          title={organization.name ?? organization.login}
          subtitle={organization.name ? organization.login : undefined}
          href={`/${organization.login}`}
        />
      ))}
    </ListSection>
  );
}

export default function AccountScreen() {
  const t = useT();
  const shell = useShell();
  const account = useActiveAccount();
  return (
    <Page title={t("app.tabs.account")} largeTitle>
      <ProfileView login={account.login}>
        <ListSection footer={account.publicOnly ? t("account.publicOnlyHint") : undefined}>
          <ListRow
            leading={<Settings aria-hidden />}
            title={t("app.settings.root")}
            href="/settings"
          />
          <ListRow
            leading={<Users aria-hidden />}
            title={t("app.accounts.switch")}
            onPress={shell.openAccountSwitcher}
          />
        </ListSection>
        <Organizations />
      </ProfileView>
    </Page>
  );
}
