export type IssueFormField =
  | { type: "markdown"; value: string }
  | {
      type: "input";
      id: string;
      label: string;
      description: string | null;
      placeholder: string | null;
      value: string;
      required: boolean;
    }
  | {
      type: "textarea";
      id: string;
      label: string;
      description: string | null;
      placeholder: string | null;
      value: string;
      render: string | null;
      required: boolean;
    }
  | {
      type: "dropdown";
      id: string;
      label: string;
      description: string | null;
      options: readonly string[];
      defaultOption?: string | null;
      multiple: boolean;
      required: boolean;
    }
  | {
      type: "checkboxes";
      id: string;
      label: string;
      description: string | null;
      options: readonly { label: string; required: boolean }[];
    };

export type IssueTemplate =
  | {
      kind: "markdown";
      fileName: string;
      name: string;
      about: string | null;
      title: string;
      body: string;
      labels: readonly string[];
    }
  | {
      kind: "form";
      fileName: string;
      name: string;
      description: string | null;
      title: string;
      labels: readonly string[];
      fields: readonly IssueFormField[];
    }
  | { kind: "unsupported"; fileName: string; name: string };

export function issueFormDefaults(
  fields: readonly IssueFormField[],
): Record<string, string | string[]> {
  return Object.fromEntries(
    fields.flatMap<[string, string | string[]]>((field) => {
      if (field.type === "input" || field.type === "textarea") return [[field.id, field.value]];
      if (field.type === "dropdown" && field.defaultOption?.trim()) {
        return [[field.id, field.multiple ? [field.defaultOption] : field.defaultOption]];
      }
      return [];
    }),
  );
}

type IssueFormAnswers = Readonly<
  Record<string, string | readonly (string | boolean | null | undefined)[] | null>
>;

function answerText(answer: IssueFormAnswers[string] | undefined): string {
  if (typeof answer === "string") return answer.trim();
  return (answer ?? [])
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join(", ");
}

export function missingRequiredIssueFields(
  fields: readonly IssueFormField[],
  answers: IssueFormAnswers,
): string[] {
  return fields.flatMap((field) => {
    if (field.type === "markdown") return [];
    const answer = answers[field.id];
    if (field.type === "checkboxes") {
      return field.options.some(
        (option, index) => option.required && !(Array.isArray(answer) && answer[index] === true),
      )
        ? [field.id]
        : [];
    }
    return field.required && !answerText(answer) ? [field.id] : [];
  });
}

export function issueFormToMarkdown(
  fields: readonly IssueFormField[],
  answers: IssueFormAnswers,
): string {
  const sections: string[] = [];
  for (const field of fields) {
    if (field.type === "markdown") continue;
    const answer = answers[field.id];
    let value: string;
    if (field.type === "checkboxes") {
      value = field.options
        .map(
          (option, index) =>
            `- [${Array.isArray(answer) && answer[index] === true ? "X" : " "}] ${option.label}`,
        )
        .join("\n");
    } else {
      value = answerText(answer) || "_No response_";
    }
    if (field.type === "textarea" && field.render && value !== "_No response_") {
      value = `\`\`\`${field.render}\n${value}\n\`\`\``;
    }
    sections.push(`### ${field.label}\n\n${value}`);
  }
  return sections.join("\n\n");
}
