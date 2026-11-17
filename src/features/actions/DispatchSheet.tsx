import { useDeferredValue, useId, useRef, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import {
  useDispatchInputs,
  useDispatchWorkflow,
  useEnvironments,
  useWorkflows,
  type DispatchInput,
  type Workflow,
} from "@/data/actions";
import { qualifiedRef, refKind, refName } from "@/data/links";
import { useFilteredRefs, useRepository } from "@/data/repo";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { isOrgAccessRestricted, showErrorToast } from "@/ui/error-toast.ts";
import { SearchField } from "@/ui/SearchField.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { buildDispatchInputs, initialValues, type FieldValues } from "./dispatch-form.ts";
import styles from "./Actions.module.css";

// iOS decimal keypads lack minus.
const NUMBER_PATTERN = "-?[0-9]*[.]?[0-9]*";

function Select(props: {
  label: string;
  description?: string | null;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  required?: boolean;
  invalid?: string | null;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {props.label}
      </label>
      <span className={styles.selectWrap}>
        <select
          id={id}
          className={styles.select}
          value={props.value}
          required={props.required ?? false}
          aria-invalid={props.invalid ? true : undefined}
          aria-describedby={props.description || props.invalid ? `${id}-note` : undefined}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden />
      </span>
      {props.invalid ? (
        <p id={`${id}-note`} className={styles.fieldError}>
          {props.invalid}
        </p>
      ) : props.description ? (
        <p id={`${id}-note`} className={styles.fieldNote}>
          {props.description}
        </p>
      ) : null}
    </div>
  );
}

function InputField(props: {
  input: DispatchInput;
  value: string | boolean;
  environments: readonly string[];
  error: string | null;
  onChange: (value: string | boolean) => void;
}) {
  const t = useT();
  const { input } = props;
  const label = input.required
    ? t("actions.dispatch.requiredLabel", { name: input.name })
    : input.name;
  if (input.type === "boolean") {
    return (
      <div className={styles.field}>
        <Switch isSelected={props.value === true} onChange={props.onChange}>
          {label}
        </Switch>
        {input.description ? <p className={styles.fieldNote}>{input.description}</p> : null}
      </div>
    );
  }
  const text = typeof props.value === "string" ? props.value : "";
  if (input.type === "choice" || input.type === "environment") {
    const choices = input.type === "choice" ? input.options : props.environments;
    const options = [
      ...(input.required ? [] : [{ value: "", label: t("actions.dispatch.none") }]),
      ...(text !== "" && !choices.includes(text) ? [text] : []).map((value) => ({
        value,
        label: value,
      })),
      ...choices.map((value) => ({ value, label: value })),
    ];
    return (
      <Select
        label={label}
        description={input.description}
        value={text}
        options={options}
        required={input.required}
        invalid={props.error}
        onChange={props.onChange}
      />
    );
  }
  return (
    <TextField
      label={label}
      {...(input.description ? { description: input.description } : {})}
      value={text}
      onChange={props.onChange}
      isRequired={input.required}
      validationBehavior="aria"
      validate={() => props.error}
      inputMode="text"
      {...(input.type === "number" ? { pattern: NUMBER_PATTERN } : {})}
      autoCapitalize="off"
      autoCorrect="off"
    />
  );
}

function DispatchForm(props: {
  owner: string;
  repo: string;
  workflow: Workflow;
  gitRef: string;
  onDone: () => void;
}) {
  const t = useT();
  const inputs = useDispatchInputs(props.owner, props.repo, props.workflow.path, props.gitRef);
  const needsEnvironments = inputs.data?.some((input) => input.type === "environment") ?? false;
  const environments = useEnvironments(props.owner, props.repo);
  const dispatch = useDispatchWorkflow();
  const [edited, setEdited] = useState<FieldValues>({});
  const [showErrors, setShowErrors] = useState(false);
  const form = useRef<HTMLFormElement | null>(null);

  if (inputs.isPending || (needsEnvironments && environments.isPending)) {
    return (
      <div className={styles.sheetState}>
        <Spinner size="small" />
      </div>
    );
  }
  if (inputs.isError) {
    return <ErrorState error={inputs.error} onRetry={() => void inputs.refetch()} />;
  }
  if (needsEnvironments && environments.isError) {
    return <ErrorState error={environments.error} onRetry={() => void environments.refetch()} />;
  }

  if (inputs.data === null) {
    return (
      <p className={styles.sheetNote}>
        {t("actions.dispatch.notDispatchable", { workflow: props.workflow.name })}
      </p>
    );
  }
  const definitions = inputs.data;
  const values = { ...initialValues(definitions), ...edited };
  const built = buildDispatchInputs(definitions, values);
  const errorFor = (name: string): string | null => {
    if (!showErrors) return null;
    const problem = built.errors[name];
    if (problem === "required") return t("actions.dispatch.required");
    if (problem === "number") return t("actions.dispatch.notNumber");
    return null;
  };

  const submit = () => {
    if (dispatch.isPending) return;
    setShowErrors(true);
    if (!built.ok) {
      requestAnimationFrame(() => {
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    const variables = {
      owner: props.owner,
      repo: props.repo,
      workflowId: props.workflow.id,
      ref: props.gitRef,
      inputs: built.inputs,
    };
    const send = () => {
      dispatch.mutate(variables, {
        onSuccess: () => {
          showToast(t("actions.dispatch.started", { workflow: props.workflow.name }));
          props.onDone();
        },
        onError: (error) => {
          if (!isOrgAccessRestricted(error)) {
            showErrorToast(t, error, t("actions.dispatch.failed"), send);
          }
        },
      });
    };
    send();
  };

  return (
    <form
      ref={form}
      className={styles.sheetForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {definitions.length === 0 ? (
        <p className={styles.fieldNote}>{t("actions.dispatch.noInputs")}</p>
      ) : null}
      {definitions.map((input) => (
        <InputField
          key={input.name}
          input={input}
          value={values[input.name] ?? ""}
          environments={needsEnvironments ? (environments.data ?? []) : []}
          error={errorFor(input.name)}
          onChange={(value) => {
            setEdited((current) => ({ ...current, [input.name]: value }));
          }}
        />
      ))}
      {showErrors && !built.ok ? (
        <p role="alert" className={styles.fieldError}>
          {t("actions.dispatch.fixErrors")}
        </p>
      ) : null}
      {isOrgAccessRestricted(dispatch.error) ? (
        <ErrorState error={dispatch.error} {...(built.ok ? { onRetry: submit } : {})} />
      ) : null}
      <Button
        type="submit"
        variant="primary"
        wide
        icon={<Play aria-hidden />}
        isPending={dispatch.isPending}
      >
        {t("actions.dispatch.submit")}
      </Button>
    </form>
  );
}

export default function DispatchSheet(props: {
  owner: string;
  repo: string;
  initialWorkflowId: number | null;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const t = useT();
  const workflows = useWorkflows(props.owner, props.repo);
  const repository = useRepository(props.owner, props.repo);
  const [workflowId, setWorkflowId] = useState<number | null>(props.initialWorkflowId);
  const [ref, setRef] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter.trim());
  const refs = useFilteredRefs(props.owner, props.repo, search);

  const active = workflows.data?.filter((workflow) => workflow.state === "active") ?? [];
  const workflow = active.find((each) => each.id === workflowId) ?? active[0] ?? null;
  const defaultBranch = repository.data?.defaultBranch;
  const selectedRef = ref ?? (defaultBranch ? qualifiedRef("branches", defaultBranch) : null);
  const { branches, tags } = refs;
  const refOptions = [
    ...branches.map((branch) => ({ value: qualifiedRef("branches", branch), label: branch })),
    ...tags.map((tag) => ({
      value: qualifiedRef("tags", tag),
      label: t("actions.dispatch.tag", { tag }),
    })),
  ];
  if (selectedRef !== null && !refOptions.some((option) => option.value === selectedRef)) {
    const name = refName(selectedRef);
    refOptions.unshift({
      value: selectedRef,
      label: refKind(selectedRef) === "tags" ? t("actions.dispatch.tag", { tag: name }) : name,
    });
  }
  const loadError = workflows.error ?? repository.error;

  return (
    <Sheet isOpen onOpenChange={props.onOpenChange} title={t("actions.dispatch.title")}>
      {loadError ? (
        <ErrorState
          error={loadError}
          onRetry={() => {
            void workflows.refetch();
            void repository.refetch();
          }}
        />
      ) : workflows.isPending || repository.isPending ? (
        <div className={styles.sheetState}>
          <Spinner size="small" />
        </div>
      ) : workflow === null ? (
        <p className={styles.sheetNote}>{t("actions.dispatch.noWorkflows")}</p>
      ) : selectedRef === null ? (
        <p className={styles.sheetNote}>{t("repo.refs.noneMessage")}</p>
      ) : (
        <>
          <div className={styles.sheetForm}>
            <Select
              label={t("actions.dispatch.workflow")}
              value={String(workflow.id)}
              options={active.map((each) => ({ value: String(each.id), label: each.name }))}
              onChange={(value) => {
                setWorkflowId(Number(value));
              }}
            />
            <SearchField
              label={t("actions.dispatch.filterRefs")}
              placeholder={t("actions.dispatch.filterRefs")}
              value={filter}
              onChange={setFilter}
            />
            {refs.isError ? (
              <ErrorState error={refs.error} onRetry={() => void refs.refetch()} />
            ) : refs.isPending ? (
              <div className={styles.sheetState}>
                <Spinner size="small" />
              </div>
            ) : search !== "" && branches.length === 0 && tags.length === 0 ? (
              <p className={styles.fieldNote}>{t("repo.refs.noMatchesMessage")}</p>
            ) : null}
            <Select
              label={t("actions.dispatch.ref")}
              description={t("actions.dispatch.refHint")}
              value={selectedRef}
              options={refOptions}
              onChange={setRef}
            />
          </div>
          <DispatchForm
            key={`${String(workflow.id)}@${selectedRef}`}
            owner={props.owner}
            repo={props.repo}
            workflow={workflow}
            gitRef={selectedRef}
            onDone={() => {
              props.onOpenChange(false);
            }}
          />
        </>
      )}
    </Sheet>
  );
}
