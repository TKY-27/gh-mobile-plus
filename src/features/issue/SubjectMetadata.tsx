import { Milestone, Pencil, Tag, Users } from "lucide-react";
import {
  useAssignableUsers,
  useMilestones,
  useRepoLabels,
  useSetAssignees,
  useSetLabels,
  useSetMilestone,
  type IssueDetail,
} from "@/data/issues";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { LabelChip } from "./LabelChip.tsx";
import { labelColors } from "./label-color.ts";
import { MultiPickerSheet, SinglePickerSheet } from "./PickerSheet.tsx";
import { useSheetSession } from "@/ui/sheet-session.ts";
import styles from "./Conversation.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const AVATAR_PX = 22;
const NO_MILESTONE = "";

export type MetadataSubject = Pick<
  IssueDetail,
  "id" | "repo" | "number" | "labels" | "assignees" | "milestone" | "viewerCan"
>;

type Editor = "labels" | "assignees" | "milestone";

function LabelsSheet(props: {
  subject: MetadataSubject;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { subject } = props;
  const labels = useRepoLabels(subject.repo.owner, subject.repo.name);
  const setLabels = useSetLabels();

  const apply = (next: readonly string[], previous: readonly string[], undoable: boolean) => {
    const variables = {
      subjectId: subject.id,
      owner: subject.repo.owner,
      repo: subject.repo.name,
      number: subject.number,
      labelNames: next,
    };
    const added = next.filter((name) => !previous.includes(name));
    const removed = previous.filter((name) => !next.includes(name));
    const [onlyAdded] = added;
    const [onlyRemoved] = removed;
    const message =
      added.length === 1 && removed.length === 0 && onlyAdded !== undefined
        ? t("issue.labels.added", { label: onlyAdded })
        : removed.length === 1 && added.length === 0 && onlyRemoved !== undefined
          ? t("issue.labels.removed", { label: onlyRemoved })
          : t("issue.labels.updated");
    setLabels.mutate(variables, {
      onError: (error) => {
        showErrorToast(t, error, t("issue.labels.failed"), () => {
          apply(next, previous, undoable);
        });
      },
    });
    if (!undoable) return;
    showToast(message, {
      action: {
        label: t("common.undo"),
        onAction: () => {
          apply(previous, next, false);
        },
      },
    });
  };

  const current = subject.labels.map((label) => label.name);
  return (
    <MultiPickerSheet
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      title={t("issue.labels.title")}
      options={labels.data?.map((label) => ({
        id: label.name,
        label: label.name,
        description: label.description,
        leading: (
          <span
            className={styles.labelSwatch}
            style={{ background: labelColors(label.color).background }}
            aria-hidden
          />
        ),
      }))}
      isPending={labels.isPending}
      error={labels.error}
      onRetry={() => void labels.refetch()}
      emptyMessage={t("issue.labels.none")}
      initial={current}
      onApply={(next) => {
        apply(next, current, true);
      }}
    />
  );
}

function AssigneesSheet(props: {
  subject: MetadataSubject;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { subject } = props;
  const users = useAssignableUsers(subject.repo.owner, subject.repo.name);
  const setAssignees = useSetAssignees();
  const apply = (logins: readonly string[]) => {
    setAssignees.mutate(
      {
        subjectId: subject.id,
        owner: subject.repo.owner,
        repo: subject.repo.name,
        number: subject.number,
        logins,
      },
      {
        onError: (error) => {
          showErrorToast(t, error, t("issue.assignees.failed"), () => {
            apply(logins);
          });
        },
      },
    );
  };
  return (
    <MultiPickerSheet
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      title={t("issue.assignees.title")}
      options={users.data?.map((user) => ({
        id: user.login,
        label: user.login,
        leading: <Avatar src={user.avatarUrl} name={user.login} size={AVATAR_PX} />,
      }))}
      isPending={users.isPending}
      error={users.error}
      onRetry={() => void users.refetch()}
      emptyMessage={t("issue.assignees.none")}
      initial={subject.assignees.map((assignee) => assignee.login)}
      onApply={apply}
    />
  );
}

function MilestoneSheet(props: {
  subject: MetadataSubject;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { subject } = props;
  const milestones = useMilestones(subject.repo.owner, subject.repo.name);
  const setMilestone = useSetMilestone();
  const apply = (milestoneId: string | null) => {
    setMilestone.mutate(
      {
        subjectId: subject.id,
        owner: subject.repo.owner,
        repo: subject.repo.name,
        number: subject.number,
        milestoneId,
      },
      {
        onError: (error) => {
          showErrorToast(t, error, t("issue.milestone.failed"), () => {
            apply(milestoneId);
          });
        },
      },
    );
  };
  return (
    <SinglePickerSheet
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      title={t("issue.milestone.title")}
      options={
        milestones.data && [
          { id: NO_MILESTONE, label: t("issue.milestone.clear") },
          ...milestones.data.map((milestone) => ({ id: milestone.id, label: milestone.title })),
        ]
      }
      isPending={milestones.isPending}
      error={milestones.error}
      onRetry={() => void milestones.refetch()}
      emptyMessage={t("issue.milestone.none")}
      selected={subject.milestone?.id ?? NO_MILESTONE}
      onSelect={(id) => {
        apply(id === NO_MILESTONE ? null : id);
      }}
    />
  );
}

export function SubjectMetadata(props: { subject: MetadataSubject }) {
  const t = useT();
  const { subject } = props;
  const { sheet: editor, open, setOpen } = useSheetSession<Editor>();
  const canEdit = subject.viewerCan.update;
  const editable = (kind: Editor) =>
    canEdit
      ? {
          onPress: () => {
            open(kind);
          },
        }
      : {};
  const editIcon = canEdit ? <Pencil className={styles.editIcon} aria-hidden /> : null;
  const sheetProps = editor && {
    subject,
    isOpen: editor.open,
    onOpenChange: setOpen,
  };

  return (
    <>
      <ListSection>
        <ListRow
          leading={<Tag aria-hidden />}
          title={t("issue.labels.title")}
          subtitle={
            subject.labels.length === 0 ? (
              t("issue.labels.empty")
            ) : (
              <span className={styles.chips}>
                {subject.labels.map((label) => (
                  <LabelChip key={label.name} label={label} />
                ))}
              </span>
            )
          }
          trailing={editIcon}
          {...editable("labels")}
        />
        <ListRow
          leading={<Users aria-hidden />}
          title={t("issue.assignees.title")}
          subtitle={
            subject.assignees.length === 0 ? (
              t("issue.assignees.empty")
            ) : (
              <span className={styles.chips}>
                {subject.assignees.map((assignee) => (
                  <span key={assignee.login} className={styles.person}>
                    <Avatar src={assignee.avatarUrl} name={assignee.login} size={AVATAR_PX} />
                    {assignee.login}
                  </span>
                ))}
              </span>
            )
          }
          trailing={editIcon}
          {...editable("assignees")}
        />
        <ListRow
          leading={<Milestone aria-hidden />}
          title={t("issue.milestone.title")}
          subtitle={subject.milestone?.title ?? t("issue.milestone.empty")}
          trailing={editIcon}
          {...editable("milestone")}
        />
      </ListSection>
      {sheetProps && editor.value === "labels" ? (
        <LabelsSheet key={editor.session} {...sheetProps} />
      ) : null}
      {sheetProps && editor.value === "assignees" ? (
        <AssigneesSheet key={editor.session} {...sheetProps} />
      ) : null}
      {sheetProps && editor.value === "milestone" ? (
        <MilestoneSheet key={editor.session} {...sheetProps} />
      ) : null}
    </>
  );
}
