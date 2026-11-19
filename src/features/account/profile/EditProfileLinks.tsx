import { useState } from "react";
import { X } from "lucide-react";
import { useIsOffline } from "@/data/status";
import { useSocialAccounts, useEditSocialAccounts } from "@/data/users/profile-edit";
import { useT } from "@/i18n/index.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TextField } from "@/ui/TextField.tsx";
import styles from "./EditProfile.module.css";

export function EditProfileLinks() {
  const t = useT();
  const offline = useIsOffline();
  const social = useSocialAccounts();
  const edit = useEditSocialAccounts();
  const [url, setUrl] = useState("");
  if (social.isPending) return <Spinner />;
  if (social.isError)
    return <ErrorState error={social.error} onRetry={() => void social.refetch()} />;
  return (
    <>
      {social.data.length > 0 ? (
        <ul className={styles.links}>
          {social.data.map((account) => (
            <li key={account.url}>
              <span>{account.url}</span>
              <IconButton
                label={t("account.editProfile.removeLink", { url: account.url })}
                isDisabled={offline || edit.isPending}
                onPress={() => {
                  edit.mutate({ url: account.url, remove: true });
                }}
              >
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!offline && !edit.isPending && url.trim()) {
            edit.mutate(
              { url: url.trim(), remove: false },
              {
                onSuccess: () => {
                  setUrl("");
                },
              },
            );
          }
        }}
      >
        <TextField
          label={t("account.editProfile.socialUrl")}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          isRequired
          isReadOnly={edit.isPending}
          value={url}
          onChange={setUrl}
        />
        <Button type="submit" isDisabled={offline || !url.trim() || edit.isPending}>
          {t("account.editProfile.addLink")}
        </Button>
      </form>
      {edit.isError ? <ErrorState error={edit.error} /> : null}
    </>
  );
}
