import { useId, useRef, useState } from "react";
import { ArrowUpLeft, ArrowUpRight, Clock, Command, CornerDownLeft, Search } from "lucide-react";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useShell } from "@/app/shell-context.ts";
import { toAppPath } from "@/data/links";
import { useRecentSearches, type SearchScope } from "@/data/search";
import { useActiveAccount } from "@/data/session";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SearchField } from "@/ui/SearchField.tsx";
import { SearchResults } from "./SearchResults.tsx";
import styles from "./SearchScreen.module.css";

const SCOPES: readonly SearchScope[] = ["repositories", "issues", "users", "code"];

const QUALIFIERS: Record<SearchScope, readonly string[]> = {
  repositories: ["user:", "org:", "language:", "topic:", "stars:"],
  issues: ["repo:", "is:", "author:", "assignee:", "label:"],
  users: ["type:", "location:", "language:", "followers:"],
  code: ["repo:", "language:", "path:", "filename:", "extension:"],
};

function suggestions(scope: SearchScope, login: string): readonly [string, MessageKey][] {
  switch (scope) {
    case "repositories":
      return [
        [`user:${login} fork:true`, "search.example.owner"],
        ["language:TypeScript stars:>100", "search.example.language"],
      ];
    case "issues":
      return [
        [`is:open assignee:${login}`, "search.example.assigned"],
        [`is:pr is:open review-requested:${login}`, "search.example.reviews"],
      ];
    case "users":
      return [
        ["type:org", "search.example.organizations"],
        ["type:user language:Rust", "search.example.developers"],
      ];
    case "code":
      return [
        ["useEffect language:TypeScript", "search.example.effect"],
        ["TODO extension:md", "search.example.markdown"],
      ];
  }
}

export default function SearchScreen() {
  const t = useT();
  const shell = useShell();
  const { login } = useActiveAccount();
  const recent = useRecentSearches();
  const scopeGroup = useId();
  const controls = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<SearchScope>("repositories");
  const [query, setQuery] = useState("");
  const typed = input.trim();
  const jump = typed ? toAppPath(typed) : null;
  const showResults = query !== "" && typed === query;
  const examples = suggestions(scope, login);
  const partial = input.match(/(?:^|\s)([a-z][a-z-]+:?[a-z]*)$/i)?.[1];
  const completions =
    partial && !showResults
      ? [
          ...new Set([
            ...QUALIFIERS[scope],
            ...examples.flatMap(([example]) => example.split(" ")),
          ]),
        ].filter(
          (clause) =>
            clause.includes(":") &&
            clause.toLowerCase().startsWith(partial.toLowerCase()) &&
            clause !== partial,
        )
      : [];

  const complete = (clause: string, prefix = "") => {
    setInput(prefix + clause + (clause.endsWith(":") ? "" : " "));
    controls.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
  };

  const submit = (text: string, nextScope: SearchScope) => {
    const trimmed = text.trim();
    setInput(trimmed);
    setScope(nextScope);
    setQuery(trimmed);
    if (trimmed) recent.add({ scope: nextScope, query: trimmed });
  };

  return (
    <Page
      title={t("app.tabs.search")}
      largeTitle
      actions={
        <IconButton label={t("app.palette.open")} onPress={shell.openCommandPalette}>
          <Command aria-hidden />
        </IconButton>
      }
    >
      <div ref={controls} className={styles.controls}>
        <SearchField
          label={t("search.field")}
          placeholder={t("search.placeholder")}
          value={input}
          onChange={(value) => {
            setInput(value);
            if (!value.trim()) setQuery("");
          }}
          onSubmit={(value) => {
            submit(value, scope);
          }}
        />
        <div className={styles.scopes} role="radiogroup" aria-label={t("search.scope.label")}>
          {SCOPES.map((next) => (
            <label key={next} className={styles.scope}>
              <input
                type="radio"
                name={scopeGroup}
                checked={next === scope}
                onChange={() => {
                  if (typed) submit(typed, next);
                  else setScope(next);
                }}
              />
              <span>{t(`search.scope.${next}`)}</span>
            </label>
          ))}
        </div>
      </div>
      {scope === "code" ? <p className={styles.note}>{t("search.codeNote")}</p> : null}
      {jump ? (
        <Link href={jump} className={moduleClass(styles.action)}>
          <ArrowUpRight aria-hidden />
          <span>{t("search.jump", { target: jump.slice(1) })}</span>
        </Link>
      ) : null}
      {showResults ? <SearchResults scope={scope} query={query} /> : null}
      {typed && !showResults ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            submit(typed, scope);
          }}
        >
          <Search aria-hidden />
          <span>{t("search.run", { query: typed })}</span>
          <CornerDownLeft className={styles.endIcon} aria-hidden />
        </button>
      ) : null}
      {partial && completions.length > 0 ? (
        <ul className={styles.completions} aria-label={t("search.qualifiers")}>
          {completions.map((clause) => (
            <li key={clause}>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  complete(clause, input.slice(0, -partial.length));
                }}
              >
                <ArrowUpLeft aria-hidden />
                <code>{clause}</code>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!typed ? (
        <>
          {recent.searches.length > 0 ? (
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>{t("search.recent.title")}</h2>
                <Button
                  variant="plain"
                  onPress={() => {
                    recent.clear();
                  }}
                >
                  {t("search.recent.clear")}
                </Button>
              </div>
              <ul className={styles.choices}>
                {recent.searches.map((entry) => (
                  <li key={`${entry.scope}:${entry.query}`}>
                    <button
                      type="button"
                      className={styles.choice}
                      onClick={() => {
                        submit(entry.query, entry.scope);
                      }}
                    >
                      <Clock aria-hidden />
                      <span>{entry.query}</span>
                      <small>{t(`search.scope.${entry.scope}`)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>{t("search.qualifiers")}</h2>
            </div>
            <ul className={styles.qualifiers}>
              {QUALIFIERS[scope].map((clause) => (
                <li key={clause}>
                  <button
                    type="button"
                    onClick={() => {
                      complete(clause);
                    }}
                  >
                    <code>{clause}</code>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>{t("search.start.title")}</h2>
            </div>
            <ul className={styles.choices}>
              {examples.map(([example, label]) => (
                <li key={example}>
                  <button
                    type="button"
                    className={styles.choice}
                    onClick={() => {
                      submit(example, scope);
                    }}
                  >
                    <Search aria-hidden />
                    <span className={styles.example}>
                      <span>{t(label)}</span>
                      <code>{example}</code>
                    </span>
                    <CornerDownLeft className={styles.endIcon} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </Page>
  );
}
