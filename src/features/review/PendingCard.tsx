import { Pencil, Trash2 } from "lucide-react";
import type { PendingComment, PendingReview } from "@/data/review";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { lineLocation } from "./location.ts";
import styles from "./Review.module.css";

export function useDraftDeletion(pending: PendingReview): (draft: PendingComment) => void {
  const t = useT();
  return (draft) => {
    pending.remove(draft.id);
    showToast(t("review.pending.deleted"), {
      action: {
        label: t("common.undo"),
        onAction: () => {
          pending.restore(draft);
        },
      },
    });
  };
}

export function PendingCard(props: {
  comment: PendingComment;
  onEdit: (comment: PendingComment) => void;
  onDelete: (comment: PendingComment) => void;
}) {
  const t = useT();
  const { comment } = props;
  const location = lineLocation(t, comment.startLine, comment.line);
  return (
    <section
      className={styles.pending}
      aria-label={t("review.pending.label", { location })}
      tabIndex={-1}
    >
      <header className={styles.threadHeader}>
        <span className={styles.pendingBadge}>{t("review.pending.badge")}</span>
        <span className={styles.threadTitle}>{location}</span>
      </header>
      <p className={styles.pendingBody}>{comment.body}</p>
      {!comment.pendingReviewId && (
        <div className={styles.threadActions}>
          <Button
            variant="plain"
            icon={<Pencil aria-hidden />}
            onPress={() => {
              props.onEdit(comment);
            }}
          >
            {t("review.pending.edit")}
          </Button>
          <Button
            variant="plain"
            icon={<Trash2 aria-hidden />}
            onPress={() => {
              props.onDelete(comment);
            }}
          >
            {t("review.pending.delete")}
          </Button>
        </div>
      )}
    </section>
  );
}
