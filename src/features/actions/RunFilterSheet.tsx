import { useId, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { RadioButton, RadioField, RadioGroup } from "react-aria-components/RadioGroup";
import { useWorkflows, type RunFilters } from "@/data/actions";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { eventLabel } from "./run-status.ts";
import styles from "./Actions.module.css";

export const NO_FILTERS: RunFilters = { workflowId: null, branch: null, event: null, status: null };

const STATUSES: readonly { id: string; label: MessageKey }[] = [
  { id: "success", label: "actions.status.success" },
  { id: "failure", label: "actions.status.failure" },
  { id: "in_progress", label: "actions.status.inProgress" },
  { id: "queued", label: "actions.status.queued" },
  { id: "waiting", label: "actions.status.waiting" },
  { id: "action_required", label: "actions.status.actionRequired" },
  { id: "cancelled", label: "actions.status.cancelled" },
];
const EVENTS: readonly string[] = [
  "push",
  "pull_request",
  "workflow_dispatch",
  "schedule",
  "release",
  "merge_group",
];

export function activeFilterCount(filters: RunFilters): number {
  return Object.values(filters).filter((value) => value !== null).length;
}

interface ChoiceOption {
  id: string;
  label: string;
}

const ANY = "";

function ChoiceGroup(props: {
  title: string;
  options: readonly ChoiceOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={styles.choiceSection}>
      <h2 id={titleId} className={styles.choiceTitle}>
        {props.title}
      </h2>
      <RadioGroup
        aria-labelledby={titleId}
        className={moduleClass(styles.choiceGroup)}
        value={props.selected ?? ANY}
        onChange={(id) => {
          props.onSelect(id === ANY ? null : id);
        }}
      >
        {props.options.map((option) => (
          <RadioField key={option.id} value={option.id} className={moduleClass(styles.choiceField)}>
            <RadioButton className={moduleClass(styles.choice)}>
              {({ isSelected }) => (
                <>
                  <span className={styles.choiceLabel}>{option.label}</span>
                  {isSelected ? <Check className={styles.check} aria-hidden /> : null}
                </>
              )}
            </RadioButton>
          </RadioField>
        ))}
      </RadioGroup>
      {props.children}
    </section>
  );
}

function WorkflowChoices(props: {
  owner: string;
  repo: string;
  selected: number | null;
  onSelect: (workflowId: number | null) => void;
}) {
  const t = useT();
  const workflows = useWorkflows(props.owner, props.repo);
  return (
    <ChoiceGroup
      title={t("actions.filters.workflow")}
      options={[
        { id: ANY, label: t("actions.filters.allWorkflows") },
        ...(workflows.data ?? []).map((workflow) => ({
          id: String(workflow.id),
          label: workflow.name,
        })),
      ]}
      selected={props.selected === null ? null : String(props.selected)}
      onSelect={(id) => {
        props.onSelect(id === null ? null : Number(id));
      }}
    >
      {workflows.isPending ? (
        <div className={styles.sheetState}>
          <Spinner size="small" />
        </div>
      ) : null}
      {workflows.isError ? (
        <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />
      ) : null}
    </ChoiceGroup>
  );
}

export function RunFilterSheet(props: {
  owner: string;
  repo: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  filters: RunFilters;
  onChange: (filters: RunFilters) => void;
}) {
  const t = useT();
  const { filters, onChange } = props;
  const [branch, setBranch] = useState(filters.branch ?? "");
  const commitBranch = () => {
    const trimmed = branch.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== filters.branch) onChange({ ...filters, branch: next });
  };
  return (
    <Sheet
      isOpen={props.isOpen}
      onOpenChange={(open) => {
        if (!open) commitBranch();
        props.onOpenChange(open);
      }}
      title={t("actions.filters.title")}
    >
      <WorkflowChoices
        owner={props.owner}
        repo={props.repo}
        selected={filters.workflowId}
        onSelect={(workflowId) => {
          onChange({ ...filters, workflowId });
        }}
      />
      <ChoiceGroup
        title={t("actions.filters.status")}
        options={[
          { id: ANY, label: t("actions.filters.any") },
          ...STATUSES.map((status) => ({ id: status.id, label: t(status.label) })),
        ]}
        selected={filters.status}
        onSelect={(status) => {
          onChange({ ...filters, status });
        }}
      />
      <ChoiceGroup
        title={t("actions.filters.event")}
        options={[
          { id: ANY, label: t("actions.filters.any") },
          ...EVENTS.map((event) => ({ id: event, label: eventLabel(t, event) })),
        ]}
        selected={filters.event}
        onSelect={(event) => {
          onChange({ ...filters, event });
        }}
      />
      <form
        className={styles.sheetForm}
        onSubmit={(event) => {
          event.preventDefault();
          commitBranch();
        }}
      >
        <TextField
          label={t("actions.filters.branch")}
          description={t("actions.filters.branchHint")}
          value={branch}
          onChange={setBranch}
          onBlur={commitBranch}
          enterKeyHint="done"
        />
        <Button
          variant="plain"
          isDisabled={activeFilterCount(filters) === 0}
          onPress={() => {
            setBranch("");
            onChange(NO_FILTERS);
          }}
        >
          {t("actions.filters.clear")}
        </Button>
      </form>
    </Sheet>
  );
}
