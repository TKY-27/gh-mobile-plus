import { useRouter } from "@tanstack/react-router";
import { toAppPath } from "@/data/links";
import { useIsOffline } from "@/data/status";
import type { Actor, ReactionGroup } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { SafeHtml } from "@/markdown/SafeHtml.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { Reactions } from "./Reactions.tsx";
import styles from "./Conversation.module.css";

const AVATAR_PX = 28;

export function MarkdownBody(props: { html: string; emptyLabel?: string }) {
  const t = useT();
  const router = useRouter();
  const offline = useIsOffline();
  if (props.html.trim() === "") {
    return props.emptyLabel ? <p className={styles.emptyBody}>{props.emptyLabel}</p> : null;
  }
  return (
    <SafeHtml
      html={props.html}
      className={moduleClass(styles.markdown)}
      toAppPath={toAppPath}
      onNavigate={(appPath) => {
        router.history.push(appPath);
      }}
      offline={offline}
      offlineImageLabel={t("issue.offlineImage")}
    />
  );
}

export function CommentCard(props: {
  subjectId: string;
  author: Actor | null;
  createdAt: string;
  bodyHtml: string;
  reactions: readonly ReactionGroup[];
  canReact: boolean;
  isOpeningPost?: boolean;
}) {
  const t = useT();
  const login = props.author?.login ?? t("issue.timeline.ghost");
  return (
    <article className={styles.comment} aria-label={t("issue.comment.label", { author: login })}>
      <header className={styles.commentHeader}>
        <Avatar src={props.author?.avatarUrl ?? null} name={login} size={AVATAR_PX} />
        <span className={styles.commentAuthor}>{login}</span>
        {props.isOpeningPost ? (
          <span className={styles.authorBadge}>{t("issue.comment.author")}</span>
        ) : null}
        <span className={styles.commentTime}>
          <RelativeTime date={props.createdAt} />
        </span>
      </header>
      <MarkdownBody
        html={props.bodyHtml}
        {...(props.isOpeningPost ? { emptyLabel: t("issue.comment.noDescription") } : {})}
      />
      <Reactions subjectId={props.subjectId} groups={props.reactions} canReact={props.canReact} />
    </article>
  );
}
