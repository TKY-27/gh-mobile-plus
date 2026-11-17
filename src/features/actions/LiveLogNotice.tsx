import { ExternalLink, ScrollText } from "lucide-react";
import type { Job } from "@/data/actions";
import { useT } from "@/i18n/index.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import styles from "./Actions.module.css";

export function LiveLogNotice(props: { job: Job; reason: "running" | "unreadable" }) {
  const t = useT();
  const running = props.reason === "running";
  return (
    <EmptyState
      icon={<ScrollText />}
      title={t(running ? "actions.log.runningTitle" : "actions.log.unreadableTitle")}
      message={t(running ? "actions.log.runningMessage" : "actions.log.unreadableMessage")}
      action={
        <a
          className={styles.linkButton}
          href={props.job.webUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(running ? "actions.log.openLive" : "common.openOnGitHub")}
          <ExternalLink aria-hidden />
        </a>
      }
    />
  );
}
