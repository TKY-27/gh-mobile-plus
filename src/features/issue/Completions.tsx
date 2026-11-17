import { useEffect, useId, useState, type RefObject } from "react";
import { useMentionCandidates, useReferenceCandidates } from "@/data/issues";
import type { RepoRef } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import type { CompletionQuery } from "./autocomplete.ts";
import styles from "./Composer.module.css";

const MAX_OPTIONS = 6;
const OPTION_AVATAR_PX = 24;

export interface CompletionOption {
  id: string;
  value: string;
  label: string;
  detail: string | null;
  avatarUrl: string | null;
}

interface CompletionsProps {
  completion: CompletionQuery;
  repo: RepoRef;
  number: number | null;
  textarea: RefObject<HTMLTextAreaElement | null>;
  onPick: (value: string) => void;
  onDismiss: () => void;
}

function ranked<T>(entries: readonly T[], key: (entry: T) => string, query: string): T[] {
  const needle = query.toLowerCase();
  const prefixed = entries.filter((entry) => key(entry).toLowerCase().startsWith(needle));
  const containing = entries.filter(
    (entry) => !prefixed.includes(entry) && key(entry).toLowerCase().includes(needle),
  );
  return [...prefixed, ...containing].slice(0, MAX_OPTIONS);
}

function MentionCompletions(props: CompletionsProps) {
  const candidates = useMentionCandidates(props.repo.owner, props.repo.name, props.number);
  const options = ranked(candidates.data ?? [], (actor) => actor.login, props.completion.query).map(
    (actor): CompletionOption => ({
      id: actor.login,
      value: actor.login,
      label: `@${actor.login}`,
      detail: null,
      avatarUrl: actor.avatarUrl,
    }),
  );
  return (
    <CompletionMenu
      {...props}
      options={options}
      isPending={candidates.isPending}
      isError={candidates.isError}
    />
  );
}

function ReferenceCompletions(props: CompletionsProps) {
  const candidates = useReferenceCandidates(props.repo.owner, props.repo.name);
  const { query } = props.completion;
  const byNumber = /^\d+$/.test(query) || query === "";
  const matches = ranked(
    candidates.data ?? [],
    (reference) => (byNumber ? String(reference.number) : reference.title),
    query,
  );
  const options = matches.map((reference): CompletionOption => ({
    id: String(reference.number),
    value: String(reference.number),
    label: `#${String(reference.number)}`,
    detail: reference.title,
    avatarUrl: null,
  }));
  return (
    <CompletionMenu
      {...props}
      options={options}
      isPending={candidates.isPending}
      isError={candidates.isError}
    />
  );
}

function CompletionMenu(
  props: CompletionsProps & {
    options: readonly CompletionOption[];
    isPending: boolean;
    isError: boolean;
  },
) {
  const t = useT();
  const listId = useId();
  const [active, setActive] = useState(0);
  const { options, textarea, onPick, onDismiss } = props;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const activeOption = options[activeIndex];

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.setAttribute("aria-expanded", "true");
    element.setAttribute("aria-controls", listId);
    if (activeOption) {
      element.setAttribute("aria-activedescendant", `${listId}-${activeOption.id}`);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      }
      if (!activeOption) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + options.length) % options.length);
      } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        onPick(activeOption.value);
      }
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.setAttribute("aria-expanded", "false");
      element.removeAttribute("aria-controls");
      element.removeAttribute("aria-activedescendant");
    };
  }, [textarea, listId, activeOption, activeIndex, options.length, onPick, onDismiss]);

  if (props.isPending) {
    return (
      <div className={styles.completions} role="status">
        <Spinner size="small" />
        {t("issue.composer.loadingSuggestions")}
      </div>
    );
  }
  if (props.isError) {
    return (
      <div className={styles.completions} role="status">
        {t("issue.composer.suggestionsFailed")}
      </div>
    );
  }
  if (options.length === 0) return null;
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={t("issue.composer.suggestions")}
      className={styles.completions}
    >
      {options.map((option, index) => (
        <li
          key={option.id}
          id={`${listId}-${option.id}`}
          role="option"
          aria-selected={index === activeIndex}
          className={styles.option}
          // Keeps focus and caret in place.
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            onPick(option.value);
          }}
        >
          {option.avatarUrl === null ? null : (
            <Avatar src={option.avatarUrl} name={option.id} size={OPTION_AVATAR_PX} />
          )}
          <span className={styles.optionLabel}>{option.label}</span>
          {option.detail === null ? null : (
            <span className={styles.optionDetail}>{option.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Completions(props: CompletionsProps) {
  return props.completion.trigger === "@" ? (
    <MentionCompletions {...props} />
  ) : (
    <ReferenceCompletions {...props} />
  );
}
