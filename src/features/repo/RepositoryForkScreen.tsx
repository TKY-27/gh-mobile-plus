import { useState } from "react";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { forkRoute } from "@/app/router.ts";
import { useCreateFork, useForkReadiness } from "@/data/repo";
import { useActiveAccount } from "@/data/session";
import { useIsOffline } from "@/data/status";
import type { RepoRef } from "@/data/types";
import { useViewerOrganizations } from "@/data/users";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Spinner } from "@/ui/Spinner.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { TextField } from "@/ui/TextField.tsx";
import styles from "./RepositorySettings.module.css";

function CreatedFork({ fork }: { fork: RepoRef }) {
  const t = useT();
  const ready = useForkReadiness(fork);
  if (ready.isError) return <ErrorState error={ready.error} onRetry={() => void ready.refetch()} />;
  if (!ready.data)
    return (
      <div className={styles.fields} role="status">
        <div className={styles.progress}>
          {ready.isFetching ? <Spinner size="small" /> : null}
          {t("repo.forking.preparing", { fork: `${fork.owner}/${fork.name}` })}
        </div>
        {ready.isFetching ? null : (
          <Button onPress={() => void ready.refetch()}>{t("repo.forking.check")}</Button>
        )}
      </div>
    );
  return (
    <Link className={moduleClass(styles.resultLink)} href={`/${fork.owner}/${fork.name}`}>
      {t("repo.forking.open", { fork: `${fork.owner}/${fork.name}` })}
    </Link>
  );
}

export default function RepositoryForkScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(forkRoute);
  const account = useActiveAccount();
  const organizations = useViewerOrganizations();
  const offline = useIsOffline();
  const create = useCreateFork(owner, repo);
  const [pickedOwner, setPickedOwner] = useState("");
  const [name, setName] = useState(repo);
  const [defaultOnly, setDefaultOnly] = useState(true);
  const ownsSource = account.login.toLowerCase() === owner.toLowerCase();
  const owners = [
    ...(ownsSource ? [] : [account.login]),
    ...(organizations.data ?? [])
      .filter((organization) => organization.viewerCanCreateRepositories)
      .map((organization) => organization.login),
  ];
  const destination = owners.includes(pickedOwner) ? pickedOwner : owners[0];
  const collides =
    destination?.toLowerCase() === owner.toLowerCase() &&
    name.trim().toLowerCase() === repo.toLowerCase();
  const disabled = create.isPending || offline;
  const canSubmit = !disabled && Boolean(destination && name.trim() && !collides);
  return (
    <Page title={t("repo.forking.title")} openOnGitHub={false}>
      <div className={styles.form}>
        <p className={styles.identity}>
          {owner}
          <span> / </span>
          <strong>{repo}</strong>
        </p>
        {organizations.isError && !create.data ? (
          <ErrorState error={organizations.error} onRetry={() => void organizations.refetch()} />
        ) : null}
        {create.data ? (
          <CreatedFork fork={create.data} />
        ) : !destination ? (
          organizations.isPending ? (
            <Spinner size="small" />
          ) : organizations.isError ? null : (
            <p role="status">{t("repo.forking.noOwner")}</p>
          )
        ) : (
          <form
            className={styles.fields}
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              create.mutate({
                name: name.trim(),
                default_branch_only: defaultOnly,
                ...(destination === account.login ? {} : { organization: destination }),
              });
            }}
          >
            <label className={styles.ownerLabel}>
              {t("repo.forking.owner")}
              <select
                className={styles.select}
                aria-label={t("repo.forking.owner")}
                value={destination}
                disabled={disabled}
                onChange={(event) => {
                  setPickedOwner(event.target.value);
                }}
              >
                {owners.map((login) => (
                  <option key={login} value={login}>
                    {login}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label={t("repo.forking.name")}
              isInvalid={collides}
              {...(collides ? { description: t("repo.forking.uniqueName") } : {})}
              value={name}
              onChange={setName}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              isRequired
              isDisabled={disabled}
            />
            <Switch isSelected={defaultOnly} onChange={setDefaultOnly} isDisabled={disabled}>
              {t("repo.forking.defaultOnly")}
            </Switch>
            {create.error ? <ErrorState error={create.error} /> : null}
            <Button
              variant="primary"
              type="submit"
              isDisabled={!canSubmit}
              isPending={create.isPending}
            >
              {t("repo.forking.create")}
            </Button>
          </form>
        )}
      </div>
    </Page>
  );
}
