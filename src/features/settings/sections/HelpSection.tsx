import { ExternalLink } from "lucide-react";
import { orgApprovalUrl } from "@/data/errors";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import styles from "../Settings.module.css";

const LIMITATIONS: readonly { title: MessageKey; body: MessageKey }[] = [
  { title: "settings.help.suspended.title", body: "settings.help.suspended.body" },
  { title: "settings.help.push.title", body: "settings.help.push.body" },
  { title: "settings.help.feed.title", body: "settings.help.feed.body" },
  { title: "settings.help.iosSignIn.title", body: "settings.help.iosSignIn.body" },
  { title: "settings.help.undo.title", body: "settings.help.undo.body" },
  { title: "settings.help.offline.title", body: "settings.help.offline.body" },
  { title: "settings.help.codeSearch.title", body: "settings.help.codeSearch.body" },
  { title: "settings.help.lock.title", body: "app.lock.privacyNote" },
];

export function HelpSection() {
  const t = useT();
  return (
    <div className={styles.help}>
      <p className={styles.helpBody}>{t("settings.help.intro")}</p>
      {LIMITATIONS.map((limitation) => (
        <section key={limitation.title} className={styles.helpItem}>
          <h2 className={styles.helpTitle}>{t(limitation.title)}</h2>
          <p className={styles.helpBody}>{t(limitation.body)}</p>
        </section>
      ))}
      <section className={styles.helpItem}>
        <h2 className={styles.helpTitle}>{t("settings.help.org.title")}</h2>
        <p className={styles.helpBody}>{t("settings.help.org.body")}</p>
        <a
          className={styles.helpLink}
          href={orgApprovalUrl()}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("settings.help.org.action")}
          <ExternalLink aria-hidden />
        </a>
      </section>
    </div>
  );
}
