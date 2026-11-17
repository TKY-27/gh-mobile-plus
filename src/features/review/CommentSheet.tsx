import { useState } from "react";
import { useSoftKeyboardOpen } from "@/app/keyboard.ts";
import { usePreferences } from "@/data/preferences";
import type { PullRequestDetail } from "@/data/pulls";
import { languageForPath } from "@/data/repo";
import {
  suggestionBlock,
  type rangeAnchor,
  useReplyToThread,
  type DiffLine,
  type PendingComment,
  type PendingReview,
  type ReviewThread,
} from "@/data/review";
import { Composer, useCurrentDraft } from "@/features/issue/Composer.tsx";
import { useT } from "@/i18n/index.tsx";
import { CodeEditor } from "@/ui/code/CodeEditor.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { lineLocation } from "./location.ts";
import styles from "./Review.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const MAX_CONTEXT_LINES = 6;

export type RangeTarget = ReturnType<typeof rangeAnchor>;

export type CommentTarget =
  | {
      kind: "new";
      commitOid: string;
      baseOid: string;
      path: string;
      anchor: RangeTarget;
      lines: readonly DiffLine[];
      suggest: boolean;
    }
  | { kind: "edit"; comment: PendingComment }
  | { kind: "reply"; thread: ReviewThread };

function withSuggestion(text: string, suggestion: string): string {
  const block = suggestionBlock(suggestion.replace(/\n$/, "").split("\n"));
  return text.trim() === "" ? block : `${text.trim()}\n\n${block}`;
}

export function CommentSheet(props: {
  pull: Pick<PullRequestDetail, "repo" | "number">;
  target: CommentTarget;
  pending: PendingReview;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSaved: (anchor: Pick<PendingComment, "line" | "side">) => void;
}) {
  const t = useT();
  const preferences = usePreferences();
  const keyboardOpen = useSoftKeyboardOpen();
  const reply = useReplyToThread();
  const { pull, target, pending } = props;
  const [body, setBody] = useState(target.kind === "edit" ? target.comment.body : "");
  const currentBody = useCurrentDraft(body);
  const [original, setOriginal] = useState(target.kind === "edit" ? target.comment : null);
  const [editNotice, setEditNotice] = useState<{ message: string; latestBody?: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const initialSuggestion =
    target.kind === "new" ? target.lines.map((line) => line.text).join("\n") : "";
  const [suggestion, setSuggestion] = useState(initialSuggestion);
  const suggest = target.kind === "new" && target.suggest;

  const title =
    target.kind === "reply"
      ? t("review.comment.replyTitle")
      : target.kind === "edit"
        ? t("review.comment.editTitle")
        : suggest
          ? t("review.comment.suggestTitle", {
              location: lineLocation(t, target.anchor.startLine, target.anchor.line),
            })
          : t("review.comment.newTitle", {
              location: lineLocation(t, target.anchor.startLine, target.anchor.line),
            });

  const close = () => {
    props.onOpenChange(false);
  };

  const submit = () => {
    if (target.kind === "new") {
      pending.add({
        commitOid: target.commitOid,
        baseOid: target.baseOid,
        path: target.path,
        ...target.anchor,
        body: suggest ? withSuggestion(body, suggestion) : body.trim(),
      });
      showToast(t("review.comment.added"));
      close();
      props.onSaved(target.anchor);
    } else if (target.kind === "edit") {
      if (!original || saving) return;
      setSaving(true);
      pending.update(original.id, body.trim(), original.body).then(
        (outcome) => {
          setSaving(false);
          if (!outcome) {
            setEditNotice({ message: t("review.comment.unavailable") });
            return;
          }
          setOriginal(outcome.saved);
          if (outcome.latestBody !== undefined) {
            setEditNotice({
              message: t("review.comment.concurrentEdit"),
              latestBody: outcome.latestBody,
            });
          } else if (currentBody.current === body) {
            close();
            props.onSaved(outcome.saved);
          }
        },
        () => {
          setSaving(false);
          setEditNotice({ message: t("review.pending.saveFailed") });
        },
      );
    } else {
      reply.mutate(
        {
          threadId: target.thread.id,
          owner: pull.repo.owner,
          repo: pull.repo.name,
          number: pull.number,
          body: body.trim(),
        },
        {
          onSuccess: () => {
            showToast(t("review.comment.replied"));
            if (currentBody.current === body) close();
          },
          onError: (error) => {
            showErrorToast(t, error, t("review.comment.replyFailed"), submit);
          },
        },
      );
    }
  };

  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={title}>
      <div className={styles.commentSheet}>
        {target.kind === "new" && !suggest ? (
          <pre className={styles.context} aria-label={t("review.comment.context")}>
            {target.lines
              .slice(-MAX_CONTEXT_LINES)
              .map((line) => line.text)
              .join("\n")}
          </pre>
        ) : null}
        {suggest ? (
          <div className={styles.suggestion}>
            <p className={styles.suggestionLabel}>{t("review.comment.suggestionLabel")}</p>
            <CodeEditor
              initialValue={initialSuggestion}
              onChange={setSuggestion}
              language={languageForPath(target.path)}
              label={t("review.comment.suggestionLabel")}
              softWrap={preferences.softWrap}
              keyboardOpen={keyboardOpen}
            />
          </div>
        ) : null}
        {editNotice && (
          <div role="alert">
            <p>{editNotice.message}</p>
            {editNotice.latestBody !== undefined && (
              <pre className={styles.context}>{editNotice.latestBody}</pre>
            )}
          </div>
        )}
        <Composer
          label={t("review.comment.field")}
          placeholder={
            suggest ? t("review.comment.suggestPlaceholder") : t("review.comment.placeholder")
          }
          value={body}
          onChange={setBody}
          repo={pull.repo}
          number={pull.number}
          submitLabel={
            target.kind === "reply"
              ? t("review.comment.reply")
              : target.kind === "edit"
                ? t("review.comment.save")
                : t("review.comment.add")
          }
          onSubmit={submit}
          isPending={reply.isPending || saving}
          allowEmpty={suggest}
        />
      </div>
    </Sheet>
  );
}
