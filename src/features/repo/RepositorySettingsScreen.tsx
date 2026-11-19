import { useId, useState, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { repoSettingsRoute } from "@/app/router.ts";
import { useRepository, useUpdateRepositorySettings, type RepositorySettings } from "@/data/repo";
import { useIsOffline } from "@/data/status";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import styles from "./RepositorySettings.module.css";

const GROUPS = [
  { title: "features", fields: ["has_issues", "has_wiki", "has_projects"] },
  {
    title: "pulls",
    fields: [
      "allow_merge_commit",
      "allow_squash_merge",
      "allow_rebase_merge",
      "allow_auto_merge",
      "delete_branch_on_merge",
    ],
  },
] as const;

function SettingsForm(props: {
  owner: string;
  repo: string;
  settings: RepositorySettings;
  refreshError: ReactNode;
}) {
  const t = useT();
  const offline = useIsOffline();
  const formId = useId();
  const update = useUpdateRepositorySettings(props.owner, props.repo);
  const [changes, setChanges] = useState<Partial<RepositorySettings>>({});
  const settings = { ...props.settings, ...changes };
  const locked = offline || update.isPending;
  const hasMergeMethod =
    settings.allow_merge_commit || settings.allow_squash_merge || settings.allow_rebase_merge;
  const canSave = !locked && hasMergeMethod && Object.keys(changes).length > 0;
  function change<K extends keyof RepositorySettings>(key: K, value: RepositorySettings[K]) {
    setChanges((current) => {
      const { [key]: previous, ...rest } = current;
      if (value === props.settings[key]) return rest;
      return previous === value ? current : { ...rest, [key]: value };
    });
    update.reset();
  }

  return (
    <Page
      title={t("repo.admin.title")}
      openOnGitHub={false}
      actions={
        <Button
          form={formId}
          type="submit"
          variant="plain"
          isDisabled={!canSave}
          isPending={update.isPending}
        >
          {t("repo.admin.save")}
        </Button>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          update.mutate(changes, {
            onSuccess: () => {
              setChanges({});
              showToast(t("repo.admin.saved"));
            },
          });
        }}
      >
        {props.refreshError}
        <div className={styles.identity}>
          {props.owner}
          <span> / </span>
          <strong>{props.repo}</strong>
        </div>
        <TextField
          label={t("repo.admin.description")}
          value={settings.description}
          onChange={(value) => {
            change("description", value);
          }}
          isDisabled={locked}
        />
        <TextField
          label={t("repo.admin.homepage")}
          value={settings.homepage}
          onChange={(value) => {
            change("homepage", value);
          }}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          isDisabled={locked}
        />
        {GROUPS.map((group) => (
          <fieldset key={group.title} className={styles.group}>
            <legend>{t(`repo.admin.${group.title}`)}</legend>
            {group.fields.map((key) => (
              <div className={styles.row} key={key}>
                <Switch
                  isSelected={settings[key]}
                  isDisabled={locked}
                  onChange={(value) => {
                    change(key, value);
                  }}
                >
                  {t(`repo.admin.${key}`)}
                </Switch>
              </div>
            ))}
          </fieldset>
        ))}
        {!hasMergeMethod ? (
          <p role="alert" className={styles.invalid}>
            {t("repo.admin.mergeRequired")}
          </p>
        ) : null}
        {update.error ? <ErrorState error={update.error} /> : null}
      </form>
    </Page>
  );
}

export default function RepositorySettingsScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(repoSettingsRoute);
  const repository = useRepository(owner, repo);
  const refreshError = repository.isError ? (
    <ErrorState error={repository.error} onRetry={() => void repository.refetch()} />
  ) : null;
  if (repository.data?.settings)
    return (
      <SettingsForm
        owner={owner}
        repo={repo}
        settings={repository.data.settings}
        refreshError={refreshError}
      />
    );
  return (
    <Page title={t("repo.admin.title")} openOnGitHub={false}>
      {repository.isPending ||
      (repository.data?.settings === undefined && repository.isFetching) ? (
        <SkeletonRows />
      ) : (
        (refreshError ?? (
          <EmptyState
            icon={<LockKeyhole />}
            title={t("repo.admin.readOnly")}
            message={t("repo.admin.readOnlyReason")}
          />
        ))
      )}
    </Page>
  );
}
