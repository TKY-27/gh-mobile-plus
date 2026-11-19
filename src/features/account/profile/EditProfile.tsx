import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useScreen } from "@/app/navigation/screen.ts";
import { profileEditorAccountId, signInHref, useActiveAccount } from "@/data/session";
import { useIsOffline } from "@/data/status";
import {
  PROFILE_FIELDS,
  useProfileEditor,
  useUpdateProfile,
  type ProfileFields,
} from "@/data/users/profile-edit";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { describeError, ErrorState } from "@/ui/ErrorState.tsx";
import { useNow } from "@/ui/RelativeTime.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { EditProfileLinks } from "./EditProfileLinks.tsx";
import styles from "./EditProfile.module.css";

function ProfileForm(props: { fields: ProfileFields; onSaved: () => void }) {
  const t = useT();
  const formatters = useFormatters();
  const offline = useIsOffline();
  const update = useUpdateProfile();
  const now = useNow();
  const [draft, setDraft] = useState<Partial<ProfileFields>>({});
  const changes: Partial<ProfileFields> = {};
  for (const field of PROFILE_FIELDS) {
    const value = draft[field];
    if (value !== undefined && value !== props.fields[field]) changes[field] = value;
  }
  if (draft.hireable !== undefined && draft.hireable !== props.fields.hireable) {
    changes.hireable = draft.hireable;
  }
  const dirty = Object.keys(changes).length > 0;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !offline && !update.isPending) {
          update.mutate(changes, { onSuccess: props.onSaved });
        }
      }}
    >
      {PROFILE_FIELDS.map((field) => (
        <TextField
          key={field}
          label={t(`account.editProfile.${field}`)}
          value={draft[field] ?? props.fields[field]}
          onChange={(value) => {
            update.reset();
            setDraft((previous) => ({ ...previous, [field]: value }));
          }}
          multiline={field === "bio"}
          inputMode={field === "email" ? "email" : field === "blog" ? "url" : "text"}
          type={field === "email" ? "email" : "text"}
          autoCapitalize={field === "bio" || field === "name" ? "sentences" : "none"}
          isReadOnly={update.isPending}
          isInvalid={update.error?.kind === "validation" && update.error.fields.includes(field)}
        />
      ))}
      <Switch
        isSelected={draft.hireable ?? props.fields.hireable}
        isDisabled={update.isPending}
        onChange={(hireable) => {
          update.reset();
          setDraft((previous) => ({ ...previous, hireable }));
        }}
      >
        {t("account.editProfile.hireable")}
      </Switch>
      {update.error ? (
        <p className={styles.error} role="alert">
          {describeError(t, formatters, update.error, now).message}
        </p>
      ) : null}
      <div className={styles.saveBar}>
        <Button
          type="submit"
          variant="primary"
          wide
          isDisabled={!dirty || offline}
          isPending={update.isPending}
        >
          {t("account.editProfile.save")}
        </Button>
      </div>
    </form>
  );
}

function ProfileEditor(props: { onSaved: () => void }) {
  const t = useT();
  const account = useActiveAccount();
  const editor = useProfileEditor();
  const [showLinks, setShowLinks] = useState(false);
  if (editor.isError && !editor.data)
    return <ErrorState error={editor.error} onRetry={() => void editor.refetch()} />;
  if (!editor.data) return <Spinner />;
  return (
    <div className={styles.editor}>
      {editor.isRefetchError ? (
        <ErrorState error={editor.error} onRetry={() => void editor.refetch()} />
      ) : null}
      {editor.data.canEdit ? (
        <>
          <ProfileForm fields={editor.data.fields} onSaved={props.onSaved} />
          <details
            className={styles.social}
            onToggle={(event) => {
              setShowLinks(event.currentTarget.open);
            }}
          >
            <summary>{t("account.editProfile.links")}</summary>
            {showLinks ? <EditProfileLinks /> : null}
          </details>
        </>
      ) : (
        <>
          <p>{t("account.editProfile.permission", { login: account.login })}</p>
          <a
            className={styles.authorize}
            href={signInHref({
              mode: "profile",
              accountId: account.id,
              publicOnly: account.publicOnly,
            })}
          >
            {t("account.editProfile.authorize")}
          </a>
        </>
      )}
    </div>
  );
}

export function EditProfileButton() {
  const t = useT();
  const offline = useIsOffline();
  const router = useRouter();
  const { href } = useScreen();
  const account = useActiveAccount();
  const resumed = profileEditorAccountId(new URL(href, window.location.origin)) === account.id;
  const [open, setOpen] = useState(resumed && !offline);
  const close = () => {
    setOpen(false);
    if (resumed) router.history.replace("/account");
  };
  return (
    <>
      <Button
        wide
        isDisabled={offline}
        onPress={() => {
          setOpen(true);
        }}
      >
        {t("account.editProfile.title")}
      </Button>
      <Sheet
        isOpen={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t("account.editProfile.title")}
      >
        {open ? (
          <ProfileEditor
            onSaved={() => {
              close();
              showToast(t("account.editProfile.saved"));
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}
