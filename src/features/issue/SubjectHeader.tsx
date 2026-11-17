import type { ReactNode } from "react";
import { Link } from "react-aria-components/Link";
import type { Actor, RepoRef } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { richMessage } from "./rich-message.tsx";
import { StatePill, type SubjectState } from "@/ui/SubjectStatus.tsx";
import styles from "./Conversation.module.css";

export function SubjectHeader(props: {
  state: SubjectState;
  repo: RepoRef;
  number: number;
  author: Actor | null;
  createdAt: string;
  children?: ReactNode;
}) {
  const t = useT();
  const { repo } = props;
  return (
    <div className={styles.header}>
      <div className={styles.headerRow}>
        <StatePill state={props.state} />
        <Link href={`/${repo.owner}/${repo.name}`} className={moduleClass(styles.repoLink)}>
          {`${repo.owner}/${repo.name}#${String(props.number)}`}
        </Link>
      </div>
      <p className={styles.headerMeta}>
        {richMessage(t, "issue.header.opened", {
          author: (
            <strong className={styles.actor}>
              {props.author?.login ?? t("issue.timeline.ghost")}
            </strong>
          ),
          time: <RelativeTime date={props.createdAt} />,
        })}
      </p>
      {props.children}
    </div>
  );
}
