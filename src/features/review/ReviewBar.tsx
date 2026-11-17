import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Lightbulb,
  MessageSquarePlus,
  TextSelect,
  X,
} from "lucide-react";
import { Toolbar } from "react-aria-components/Toolbar";
import { useT } from "@/i18n/index.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./Review.module.css";

export interface SelectionSummary {
  lines: string;
  problem: string | null;
  canSuggest: boolean;
}

export function ReviewBar(props: {
  selection: SelectionSummary | null;
  fileIndex: number;
  fileCount: number;
  pendingCount: number;
  hasHunks: boolean;
  onFile: (direction: 1 | -1) => void;
  onHunk: (direction: 1 | -1) => void;
  onReview: () => void;
  onComment: (suggest: boolean) => void;
  onSelectRange: () => void;
  onClearSelection: () => void;
}) {
  const t = useT();
  const { selection } = props;
  return (
    <Toolbar className={moduleClass(styles.bar)} aria-label={t("review.bar.label")}>
      <p className={styles.srOnly} role="status">
        {selection ? t("review.bar.selected", { lines: selection.lines }) : ""}
      </p>
      {selection ? (
        <>
          <IconButton label={t("review.bar.clearSelection")} onPress={props.onClearSelection}>
            <X aria-hidden />
          </IconButton>
          <span className={styles.barStatus}>
            {selection.problem ?? t("review.bar.lines", { lines: selection.lines })}
          </span>
          <IconButton label={t("review.bar.selectRange")} onPress={props.onSelectRange}>
            <TextSelect aria-hidden />
          </IconButton>
          <IconButton
            label={t("review.bar.suggest")}
            isDisabled={selection.problem !== null || !selection.canSuggest}
            onPress={() => {
              props.onComment(true);
            }}
          >
            <Lightbulb aria-hidden />
          </IconButton>
          <Button
            variant="primary"
            icon={<MessageSquarePlus aria-hidden />}
            isDisabled={selection.problem !== null}
            onPress={() => {
              props.onComment(false);
            }}
          >
            {t("review.bar.comment")}
          </Button>
        </>
      ) : (
        <>
          <IconButton
            label={t("review.bar.previousFile")}
            isDisabled={props.fileIndex <= 0}
            onPress={() => {
              props.onFile(-1);
            }}
          >
            <ChevronLeft aria-hidden />
          </IconButton>
          <IconButton
            label={t("review.bar.previousHunk")}
            isDisabled={!props.hasHunks}
            onPress={() => {
              props.onHunk(-1);
            }}
          >
            <ChevronUp aria-hidden />
          </IconButton>
          <IconButton
            label={t("review.bar.nextHunk")}
            isDisabled={!props.hasHunks}
            onPress={() => {
              props.onHunk(1);
            }}
          >
            <ChevronDown aria-hidden />
          </IconButton>
          <IconButton
            label={t("review.bar.nextFile")}
            isDisabled={props.fileIndex >= props.fileCount - 1}
            onPress={() => {
              props.onFile(1);
            }}
          >
            <ChevronRight aria-hidden />
          </IconButton>
          <span className={styles.barPosition}>
            {t("review.bar.position", { index: props.fileIndex + 1, count: props.fileCount })}
          </span>
          <Button variant="primary" onPress={props.onReview}>
            {props.pendingCount > 0
              ? t("review.bar.reviewCount", { count: props.pendingCount })
              : t("review.bar.review")}
          </Button>
        </>
      )}
    </Toolbar>
  );
}
