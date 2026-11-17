import { useCallback, useState } from "react";
import { ArrowUpRight, Clock, Command, Info, SearchX, Search as SearchIcon } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { useShell } from "@/app/shell-context.ts";
import { toAppPath } from "@/data/links";
import { useRecentSearches, useSearch, type SearchResult, type SearchScope } from "@/data/search";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { SearchField } from "@/ui/SearchField.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { estimateResult, resultPath, SearchResultRow } from "./SearchResultRow.tsx";
import styles from "./SearchScreen.module.css";

const SCOPES: readonly { id: SearchScope; label: MessageKey }[] = [
  { id: "repositories", label: "search.scope.repositories" },
  { id: "issues", label: "search.scope.issues" },
  { id: "users", label: "search.scope.users" },
  { id: "code", label: "search.scope.code" },
];

const SCOPE_LABELS: Readonly<Record<SearchScope, MessageKey>> = {
  repositories: "search.scope.repositories",
  issues: "search.scope.issues",
  users: "search.scope.users",
  code: "search.scope.code",
};

function Results(props: { scope: SearchScope; query: string }) {
  const t = useT();
  const formatters = useFormatters();
  const search = useSearch(props.scope, props.query);
  // GitHub can repeat results across pages.
  const results = [
    ...new Map(
      (search.data?.pages.flatMap((page) => page.items) ?? []).map((result) => [
        resultPath(result),
        result,
      ]),
    ).values(),
  ];
  const total = search.data?.pages[0]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (search.isPending) return <SkeletonRows rows={6} />;
  if (search.isError && results.length === 0) {
    return <ErrorState error={search.error} onRetry={() => void search.refetch()} />;
  }
  if (results.length === 0) {
    return (
      <EmptyState
        icon={<SearchX />}
        title={t("search.noResults.title", { query: props.query })}
        message={t("search.noResults.message")}
      />
    );
  }
  return (
    <div aria-busy={search.isFetching || undefined}>
      <p className={styles.total} role="status">
        {t("search.total", { count: total, formatted: formatters.number(total) })}
      </p>
      <VirtualList
        label={t("search.resultsLabel")}
        items={results}
        getKey={resultPath}
        estimateSize={estimateResult}
        renderItem={(result: SearchResult) => <SearchResultRow result={result} />}
        onEndReached={loadMore}
      />
      {isFetchingNextPage ? (
        <div className={styles.loadingMore}>
          <Spinner size="small" />
        </div>
      ) : null}
      {search.isFetchNextPageError ? (
        <ErrorState error={search.error} onRetry={() => void search.fetchNextPage()} />
      ) : null}
    </div>
  );
}

export default function SearchScreen() {
  const t = useT();
  const shell = useShell();
  const recent = useRecentSearches();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<SearchScope>("repositories");
  const [query, setQuery] = useState("");
  const typed = input.trim();
  const jump = typed ? toAppPath(typed) : null;

  const submit = (text: string, nextScope: SearchScope) => {
    const trimmed = text.trim();
    setInput(trimmed);
    setScope(nextScope);
    setQuery(trimmed);
    if (trimmed) recent.add({ scope: nextScope, query: trimmed });
  };

  let body;
  if (query) body = <Results scope={scope} query={query} />;
  else if (recent.searches.length > 0) {
    body = (
      <ListSection
        title={t("search.recent.title")}
        footer={
          <Button
            variant="plain"
            onPress={() => {
              recent.clear();
            }}
          >
            {t("search.recent.clear")}
          </Button>
        }
      >
        {recent.searches.map((entry) => (
          <ListRow
            key={`${entry.scope}:${entry.query}`}
            leading={<Clock aria-hidden />}
            title={entry.query}
            detail={t(SCOPE_LABELS[entry.scope])}
            onPress={() => {
              submit(entry.query, entry.scope);
            }}
          />
        ))}
      </ListSection>
    );
  } else if (!jump) {
    body = (
      <EmptyState
        icon={<SearchIcon />}
        title={t("search.start.title")}
        message={t("search.start.message")}
      />
    );
  }

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
      <div className={styles.controls}>
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
        <SegmentedControl
          label={t("search.scope.label")}
          segments={SCOPES.map((each) => ({ id: each.id, label: t(each.label) }))}
          selected={scope}
          onChange={(next) => {
            if (query) submit(query, next);
            else setScope(next);
          }}
        />
        {scope === "code" ? (
          <p className={styles.note}>
            <Info aria-hidden />
            <span>{t("search.codeNote")}</span>
          </p>
        ) : null}
      </div>
      {jump ? (
        <ListSection>
          <ListRow
            href={jump}
            leading={<ArrowUpRight aria-hidden />}
            title={t("search.jump", { target: jump.slice(1) })}
          />
        </ListSection>
      ) : null}
      {body}
    </Page>
  );
}
