import { Check, Plus } from "lucide-react";
import { MAX_ACCOUNTS, signInHref, switchAccount, useSession } from "@/data/session";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { Sheet } from "@/ui/Sheet.tsx";

const ROW_AVATAR_PX = 36;

export default function AccountSwitcher(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { accounts, activeAccount } = useSession();
  const atLimit = accounts.length >= MAX_ACCOUNTS;
  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={t("app.accounts.title")}>
      <ListSection footer={atLimit ? t("app.accounts.limit", { max: MAX_ACCOUNTS }) : undefined}>
        {accounts.map((account) =>
          account.status === "active" ? (
            <ListRow
              key={account.id}
              leading={<Avatar src={account.avatarUrl} name={account.login} size={ROW_AVATAR_PX} />}
              title={account.login}
              subtitle={account.publicOnly ? t("app.accounts.publicOnly") : undefined}
              trailing={
                account.id === activeAccount?.id ? (
                  <Check aria-label={t("app.accounts.current")} role="img" />
                ) : undefined
              }
              onPress={() => {
                if (account.id !== activeAccount?.id) switchAccount(account.id);
                props.onOpenChange(false);
              }}
            />
          ) : (
            <ListRow
              key={account.id}
              leading={<Avatar src={account.avatarUrl} name={account.login} size={ROW_AVATAR_PX} />}
              title={account.login}
              subtitle={t("app.accounts.signedOut")}
              href={signInHref({
                mode: "reauth",
                accountId: account.id,
                publicOnly: account.publicOnly,
              })}
            />
          ),
        )}
        {atLimit ? null : (
          <ListRow
            leading={<Plus aria-hidden />}
            title={t("app.accounts.add")}
            href={signInHref({ mode: "add", publicOnly: false })}
          />
        )}
      </ListSection>
    </Sheet>
  );
}
