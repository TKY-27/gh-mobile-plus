import { useId, useState } from "react";
import { ExternalLink, FilePlus2, FileText } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { newIssueRoute } from "@/app/router.ts";
import { useComposerActive } from "@/app/updates.ts";
import { draftKeys, useDraft } from "@/data/drafts";
import {
  issueFormDefaults,
  issueFormToMarkdown,
  missingRequiredIssueFields,
  useCreateIssue,
  useIssueTemplates,
  type IssueFormField,
  type IssueTemplate,
} from "@/data/issues";
import type { RepoRef } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { Checkbox } from "@/ui/Checkbox.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";
import { openExternal } from "@/ui/external.ts";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { TextArea, TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { Composer, MarkdownPreview, useCurrentDraft } from "./Composer.tsx";
import styles from "./NewIssue.module.css";

type Answer = string | string[] | boolean[];

interface NewIssueDraft {
  chosen: boolean;
  template: string | null;
  title: string;
  body: string;
  answers: Record<string, Answer>;
}

const EMPTY_DRAFT: NewIssueDraft = {
  chosen: false,
  template: null,
  title: "",
  body: "",
  answers: {},
};

function sameDraft(current: NewIssueDraft, sent: NewIssueDraft): boolean {
  return (
    current.chosen === sent.chosen &&
    current.template === sent.template &&
    current.title === sent.title &&
    current.body === sent.body &&
    Object.keys(current.answers).length === Object.keys(sent.answers).length &&
    Object.entries(sent.answers).every(
      ([field, answer]) => JSON.stringify(current.answers[field]) === JSON.stringify(answer),
    )
  );
}

function FormField(props: {
  field: IssueFormField;
  repo: RepoRef;
  answer: Answer | undefined;
  invalid: boolean;
  onAnswer: (answer: Answer) => void;
}) {
  const t = useT();
  const selectId = useId();
  const { field, answer, invalid } = props;
  const errorMessage = t("issue.new.required");
  switch (field.type) {
    case "markdown":
      return <MarkdownPreview text={field.value} repo={props.repo} />;
    case "input":
      return (
        <TextField
          label={field.label}
          {...(field.description ? { description: field.description } : {})}
          placeholder={field.placeholder ?? ""}
          value={typeof answer === "string" ? answer : ""}
          onChange={props.onAnswer}
          isRequired={field.required}
          isInvalid={invalid}
          validate={() => (invalid ? errorMessage : null)}
        />
      );
    case "textarea":
      return (
        <div className={field.render ? styles.codeField : undefined}>
          <TextArea
            label={field.label}
            {...(field.description ? { description: field.description } : {})}
            placeholder={field.placeholder ?? ""}
            value={typeof answer === "string" ? answer : ""}
            onChange={props.onAnswer}
            isRequired={field.required}
            isInvalid={invalid}
            validate={() => (invalid ? errorMessage : null)}
          />
        </div>
      );
    case "dropdown": {
      const selected = Array.isArray(answer)
        ? answer.filter((value) => typeof value === "string")
        : [];
      if (field.multiple) {
        return (
          <fieldset className={styles.group} aria-invalid={invalid || undefined}>
            <legend className={styles.legend}>{field.label}</legend>
            {field.description ? <p className={styles.description}>{field.description}</p> : null}
            {field.options.map((option) => (
              <Checkbox
                key={option}
                isSelected={selected.includes(option)}
                onChange={(checked) => {
                  props.onAnswer(
                    checked ? [...selected, option] : selected.filter((value) => value !== option),
                  );
                }}
              >
                {option}
              </Checkbox>
            ))}
            {invalid ? <p className={styles.error}>{errorMessage}</p> : null}
          </fieldset>
        );
      }
      return (
        <div className={styles.selectField}>
          <label htmlFor={selectId} className={styles.legend}>
            {field.label}
          </label>
          {field.description ? <p className={styles.description}>{field.description}</p> : null}
          <select
            id={selectId}
            className={styles.select}
            value={typeof answer === "string" ? answer : ""}
            required={field.required}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              props.onAnswer(event.target.value);
            }}
          >
            <option value="">{t("issue.new.choose")}</option>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {invalid ? <p className={styles.error}>{errorMessage}</p> : null}
        </div>
      );
    }
    case "checkboxes": {
      const checked = Array.isArray(answer) ? answer.map((value) => value === true) : [];
      return (
        <fieldset className={styles.group} aria-invalid={invalid || undefined}>
          <legend className={styles.legend}>{field.label}</legend>
          {field.description ? <p className={styles.description}>{field.description}</p> : null}
          {field.options.map((option, index) => (
            <Checkbox
              key={option.label}
              isSelected={checked[index] === true}
              onChange={(value) => {
                const next = field.options.map((_, at) =>
                  at === index ? value : checked[at] === true,
                );
                props.onAnswer(next);
              }}
            >
              {option.required
                ? t("issue.new.requiredOption", { label: option.label })
                : option.label}
            </Checkbox>
          ))}
          {invalid ? <p className={styles.error}>{errorMessage}</p> : null}
        </fieldset>
      );
    }
  }
}

function TemplatePicker(props: {
  repo: RepoRef;
  templates: readonly IssueTemplate[];
  onChoose: (template: IssueTemplate | null) => void;
}) {
  const t = useT();
  const { repo } = props;
  return (
    <ListSection title={t("issue.new.chooseTemplate")}>
      {props.templates.map((template) =>
        template.kind === "unsupported" ? (
          <ListRow
            key={template.fileName}
            leading={<ExternalLink aria-hidden />}
            title={template.name}
            subtitle={t("issue.new.unsupportedTemplate")}
            onPress={() => {
              openExternal(
                `https://github.com/${repo.owner}/${repo.name}/issues/new?template=${encodeURIComponent(template.fileName)}`,
              );
            }}
          />
        ) : (
          <ListRow
            key={template.fileName}
            leading={<FileText aria-hidden />}
            title={template.name}
            subtitle={
              (template.kind === "markdown" ? template.about : template.description) ?? undefined
            }
            onPress={() => {
              props.onChoose(template);
            }}
          />
        ),
      )}
      <ListRow
        leading={<FilePlus2 aria-hidden />}
        title={t("issue.new.blank")}
        subtitle={t("issue.new.blankHint")}
        onPress={() => {
          props.onChoose(null);
        }}
      />
    </ListSection>
  );
}

function NewIssueForm(props: { repo: RepoRef; templates: readonly IssueTemplate[] }) {
  const t = useT();
  const router = useRouter();
  const { repo, templates } = props;
  const [draft, setDraft, clearDraft] = useDraft<NewIssueDraft>(
    draftKeys.newIssue(repo.owner, repo.name),
    EMPTY_DRAFT,
  );
  const [attempted, setAttempted] = useState(false);
  const create = useCreateIssue();
  useComposerActive(draft.title.trim() !== "" || draft.body.trim() !== "");
  const template = templates.find((candidate) => candidate.fileName === draft.template) ?? null;
  const form = template?.kind === "form" ? template : null;
  // Older drafts omit untouched defaults.
  const answers = form ? { ...issueFormDefaults(form.fields), ...draft.answers } : draft.answers;
  const sentDraft = { ...draft, answers };
  const latest = useCurrentDraft({ draft: sentDraft, clearDraft });
  const missing = form ? missingRequiredIssueFields(form.fields, answers) : [];
  const titleMissing = draft.title.trim() === "";

  if (!draft.chosen && templates.length > 0) {
    return (
      <TemplatePicker
        repo={repo}
        templates={templates}
        onChoose={(chosen) => {
          setDraft({
            chosen: true,
            template: chosen?.fileName ?? null,
            title: chosen && chosen.kind !== "unsupported" ? chosen.title : "",
            body: chosen?.kind === "markdown" ? chosen.body : "",
            answers: chosen?.kind === "form" ? issueFormDefaults(chosen.fields) : {},
          });
        }}
      />
    );
  }

  const submit = () => {
    setAttempted(true);
    if (create.isPending || titleMissing || missing.length > 0) return;
    const body = form ? issueFormToMarkdown(form.fields, answers) : draft.body;
    const labels = template && template.kind !== "unsupported" ? template.labels : [];
    create.mutate(
      { owner: repo.owner, repo: repo.name, title: draft.title.trim(), body, labels },
      {
        onSuccess: ({ number }) => {
          const current = latest.current;
          if (current.clearDraft === clearDraft && sameDraft(current.draft, sentDraft)) {
            clearDraft();
          }
          showToast(t("issue.new.created", { number }));
          router.history.replace(`/${repo.owner}/${repo.name}/issues/${String(number)}`);
        },
        onError: (error) => {
          showErrorToast(t, error, t("issue.new.failed"), submit);
        },
      },
    );
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {template ? (
        <p className={styles.templateRow}>
          <span>{t("issue.new.usingTemplate", { name: template.name })}</span>
          {templates.length > 0 ? (
            <Button
              variant="plain"
              onPress={() => {
                setDraft({ ...draft, chosen: false });
              }}
            >
              {t("issue.new.changeTemplate")}
            </Button>
          ) : null}
        </p>
      ) : null}
      <TextField
        label={t("issue.new.title")}
        value={draft.title}
        onChange={(title) => {
          setDraft({ ...draft, title });
        }}
        isRequired
        isInvalid={attempted && titleMissing}
        validate={() => (attempted && titleMissing ? t("issue.new.required") : null)}
      />
      {form ? (
        <>
          {form.fields.map((field, index) => (
            <FormField
              key={field.type === "markdown" ? `markdown:${String(index)}` : field.id}
              field={field}
              repo={repo}
              answer={field.type === "markdown" ? undefined : answers[field.id]}
              invalid={attempted && field.type !== "markdown" && missing.includes(field.id)}
              onAnswer={(answer) => {
                if (field.type === "markdown") return;
                setDraft({ ...draft, answers: { ...answers, [field.id]: answer } });
              }}
            />
          ))}
          <Button type="submit" variant="primary" wide isPending={create.isPending}>
            {t("issue.new.submit")}
          </Button>
        </>
      ) : (
        <Composer
          label={t("issue.new.body")}
          placeholder={t("issue.new.bodyPlaceholder")}
          value={draft.body}
          onChange={(body) => {
            setDraft({ ...draft, body });
          }}
          repo={repo}
          number={null}
          submitLabel={t("issue.new.submit")}
          onSubmit={submit}
          isPending={create.isPending}
          allowEmpty
        />
      )}
    </form>
  );
}

export default function NewIssueScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(newIssueRoute);
  const templates = useIssueTemplates(owner, repo);
  return (
    <Page title={t("issue.new.screenTitle")}>
      {templates.isPending ? (
        <ScreenSkeleton />
      ) : templates.isError ? (
        <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
      ) : (
        <NewIssueForm repo={{ owner, name: repo }} templates={templates.data} />
      )}
    </Page>
  );
}
