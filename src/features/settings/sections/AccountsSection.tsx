import { useState } from "react";
import { Check, LogOut, Plus } from "lucide-react";
import {
  MAX_ACCOUNTS,
  readSession,
  signInHref,
  signOut,
  signOutAll,
  switchAccount,
  useSession,
  type Account,
} from "@/data/session";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";
import { ConfirmSheet } from "@/ui/ConfirmSheet.tsx";
import styles from "../Settings.module.css";

const ROW_AVATAR_PX = 36;

type SignOutTarget = { kind: "one"; account: Account } | { kind: "all" };

function AccountRow(props: { account: Account; isCurrent: boolean }) {
  const t = useT();
  const { account } = props;
  const avatar = <Avatar src={account.avatarUrl} name={account.login} size={ROW_AVATAR_PX} />;
  if (account.status === "signedOut") {
    return (
      <ListRow
        leading={avatar}
        title={account.login}
        subtitle={t("app.accounts.signedOut")}
        href={signInHref({ mode: "reauth", accountId: account.id, publicOnly: account.publicOnly })}
      />
    );
  }
  const notes = [
    props.isCurrent ? t("app.accounts.current") : null,
    account.publicOnly ? t("app.accounts.publicOnly") : null,
  ].filter((note) => note !== null);
  return (
    <ListRow
      leading={avatar}
      title={account.login}
      subtitle={notes.length > 0 ? notes.join(" · ") : undefined}
      trailing={props.isCurrent ? <Check aria-hidden /> : undefined}
      {...(props.isCurrent
        ? {}
        : {
            onPress: () => {
              switchAccount(account.id);
              showToast(t("settings.accounts.switched", { login: account.login }));
            },
          })}
    />
  );
}

export function AccountsSection() {
  const t = useT();
  const { accounts, activeAccount } = useSession();
  const [publicOnly, setPublicOnly] = useState(false);
  const [confirming, setConfirming] = useState<SignOutTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState<SignOutTarget | null>(null);
  const atLimit = accounts.length >= MAX_ACCOUNTS;

  const run = (target: SignOutTarget) => {
    setSigningOut(target);
    const request = target.kind === "all" ? signOutAll() : signOut(target.account.id);
    request.then(
      () => {
        setSigningOut(null);
      },
      (error: unknown) => {
        setSigningOut(null);
        const targetIds = target.kind === "all" ? null : new Set([target.account.id]);
        const stillSignedIn = readSession().accounts.some(
          (account) => account.status === "active" && (targetIds?.has(account.id) ?? true),
        );
        // Local sign-out succeeded; revoke retries later.
        if (!stillSignedIn) {
          showToast(t("settings.accounts.signedOutLocally"));
          return;
        }
        showErrorToast(t, error, t("app.accounts.signOutFailed"), () => {
          run(target);
        });
      },
    );
  };

  const confirmTitle =
    confirming?.kind === "one"
      ? t("settings.accounts.confirmTitle", { login: confirming.account.login })
      : t("settings.accounts.confirmAllTitle");

  return (
    <>
      <ListSection
        title={t("settings.accounts.signedIn")}
        footer={t("settings.accounts.switchHint")}
      >
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            isCurrent={account.id === activeAccount?.id}
          />
        ))}
      </ListSection>
      <ListSection
        title={t("settings.accounts.addTitle")}
        footer={
          atLimit ? t("app.accounts.limit", { max: MAX_ACCOUNTS }) : t("app.signIn.publicOnlyHint")
        }
      >
        <li className={styles.control}>
          <Switch isSelected={publicOnly} onChange={setPublicOnly} isDisabled={atLimit}>
            {t("app.signIn.publicOnly")}
          </Switch>
        </li>
        {atLimit ? (
          <ListRow
            leading={<Plus aria-hidden className={styles.muted} />}
            title={<span className={styles.muted}>{t("app.accounts.add")}</span>}
            subtitle={t("settings.accounts.limitReached")}
          />
        ) : (
          <ListRow
            leading={<Plus aria-hidden />}
            title={t("app.accounts.add")}
            href={signInHref({ mode: "add", publicOnly })}
          />
        )}
      </ListSection>
      <ListSection title={t("settings.accounts.signOutTitle")}>
        {accounts.map((account) => (
          <ListRow
            key={account.id}
            leading={<LogOut aria-hidden className={styles.destructive} />}
            title={
              <span className={styles.destructive}>
                {t("settings.accounts.signOutOf", { login: account.login })}
              </span>
            }
            trailing={
              signingOut?.kind === "one" && signingOut.account.id === account.id ? (
                <Spinner size="small" />
              ) : undefined
            }
            onPress={() => {
              if (signingOut) return;
              setConfirming({ kind: "one", account });
              setConfirmOpen(true);
            }}
          />
        ))}
        {accounts.length > 1 ? (
          <ListRow
            leading={<LogOut aria-hidden className={styles.destructive} />}
            title={<span className={styles.destructive}>{t("app.lock.signOutAll")}</span>}
            trailing={signingOut?.kind === "all" ? <Spinner size="small" /> : undefined}
            onPress={() => {
              if (signingOut) return;
              setConfirming({ kind: "all" });
              setConfirmOpen(true);
            }}
          />
        ) : null}
      </ListSection>
      <ConfirmSheet
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmTitle}
        message={t("settings.accounts.confirmMessage")}
        confirmLabel={t("app.accounts.signOut")}
        destructive
        onConfirm={() => {
          if (confirming) run(confirming);
        }}
      />
    </>
  );
}
