import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useCreateRepository } from "@/data/repo/create";
import { useActiveAccount } from "@/data/session";
import { useIsOffline } from "@/data/status";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Switch } from "@/ui/Switch.tsx";
import { TextField } from "@/ui/TextField.tsx";
import styles from "./RepositorySettings.module.css";

export default function RepositoryCreateScreen() {
  const t = useT();
  const account = useActiveAccount();
  const router = useRouter();
  const offline = useIsOffline();
  const create = useCreateRepository();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(!account.publicOnly);
  const [readme, setReadme] = useState(false);
  const disabled = offline || create.isPending;
  const created = create.data;
  return (
    <Page title={t("repo.create.title")} openOnGitHub={false}>
      {created ? (
        <Link className={moduleClass(styles.resultLink)} href={`/${created.owner}/${created.name}`}>
          {t("repo.create.open", { repo: `${created.owner}/${created.name}` })}
        </Link>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !name.trim()) return;
            create.mutate(
              {
                name: name.trim(),
                description: description.trim(),
                private: isPrivate,
                auto_init: readme,
              },
              {
                onSuccess: ({ owner, name: repo }) => {
                  if (router.history.location.pathname === "/new")
                    router.history.replace(`/${owner}/${repo}`);
                },
              },
            );
          }}
        >
          <div className={styles.identity}>
            {t("repo.forking.owner")} <strong>{account.login}</strong>
          </div>
          <TextField
            label={t("repo.forking.name")}
            value={name}
            onChange={setName}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            isRequired
            isDisabled={disabled}
          />
          <TextField
            label={t("repo.admin.description")}
            value={description}
            onChange={setDescription}
            isDisabled={disabled}
          />
          <label className={styles.ownerLabel}>
            {t("repo.create.visibility")}
            <select
              className={styles.select}
              aria-label={t("repo.create.visibility")}
              value={isPrivate ? "private" : "public"}
              disabled={disabled || account.publicOnly}
              onChange={(event) => {
                setPrivate(event.target.value === "private");
              }}
            >
              <option value="public">{t("repo.create.public")}</option>
              {!account.publicOnly ? <option value="private">{t("repo.private")}</option> : null}
            </select>
          </label>
          {account.publicOnly ? (
            <p className={styles.identity}>{t("repo.create.publicOnly")}</p>
          ) : null}
          <Switch isSelected={readme} onChange={setReadme} isDisabled={disabled}>
            {t("repo.create.readme")}
          </Switch>
          {create.error ? <ErrorState error={create.error} /> : null}
          <Button
            variant="primary"
            type="submit"
            isDisabled={disabled || !name.trim()}
            isPending={create.isPending}
          >
            {t("repo.create.submit")}
          </Button>
        </form>
      )}
    </Page>
  );
}
