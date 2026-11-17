import { useAddComment } from "@/data/issues";
import { draftKeys, useDraft } from "@/data/drafts";
import type { RepoRef } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";
import { showToast } from "@/ui/Toast.tsx";
import { Composer, useCurrentDraft } from "./Composer.tsx";

export function ConversationComposer(props: { subjectId: string; repo: RepoRef; number: number }) {
  const t = useT();
  const { repo, number } = props;
  const [body, setBody, clearBody] = useDraft(draftKeys.comment(repo.owner, repo.name, number), "");
  const addComment = useAddComment();
  const latest = useCurrentDraft({ body, clearBody });

  const submit = () => {
    const text = body;
    addComment.mutate(
      { subjectId: props.subjectId, body: text },
      {
        onSuccess: () => {
          if (latest.current.body === text && latest.current.clearBody === clearBody) clearBody();
          showToast(t("issue.comment.posted"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("issue.comment.failed"), submit);
        },
      },
    );
  };

  return (
    <Composer
      pinned
      label={t("issue.comment.field")}
      placeholder={t("issue.comment.placeholder")}
      value={body}
      onChange={setBody}
      repo={repo}
      number={number}
      submitLabel={t("issue.comment.submit")}
      onSubmit={submit}
      isPending={addComment.isPending}
    />
  );
}
