import { type ReactNode, useCallback, useState } from "react";
import { ArrowDownWideNarrow, Check, ChevronDown, SearchX } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import {
  SEARCH_SORTS,
  useSearch,
  withSearchSort,
  type SearchResult,
  type SearchScope,
  type SearchSort,
} from "@/data/search";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { Menu } from "@/ui/Menu.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { estimateResult, resultPath, SearchResultRow } from "./SearchResultRow.tsx";
import styles from "./SearchScreen.module.css";

const EXPLICIT_SORT_CLAUSE = /(?:^|\s)sort:\S+/i;

export function SearchResults(props: {
  scope: SearchScope;
  query: string;
  defaultSort?: SearchSort;
  displayQuery?: string;
  offlineFallback?: ReactNode;
}) {
  const t = useT();
  const formatters = useFormatters();
  const savedOnly = Boolean(props.offlineFallback);
  const sortOptions = SEARCH_SORTS[props.scope];
  const [selectedSort, setSelectedSort] = useState<SearchSort | null>(null);
  const fallbackSort: SearchSort =
    props.defaultSort && sortOptions.includes(props.defaultSort)
      ? props.defaultSort
      : (sortOptions[0] ?? "bestMatch");
  const activeSort: SearchSort =
    selectedSort && sortOptions.includes(selectedSort) ? selectedSort : fallbackSort;
  const effectiveQuery =
    sortOptions.length > 0
      ? selectedSort && sortOptions.includes(selectedSort)
        ? withSearchSort(props.query, selectedSort)
        : props.defaultSort && !EXPLICIT_SORT_CLAUSE.test(props.query)
          ? withSearchSort(props.query, fallbackSort)
          : props.query
      : props.query;
  const search = useSearch(props.scope, effectiveQuery, !savedOnly);
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
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = search;
  const loadMore = useCallback(() => {
    if (!savedOnly && hasNextPage && !isFetchingNextPage && !isFetchNextPageError)
      void fetchNextPage();
  }, [savedOnly, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (savedOnly && !search.data) return props.offlineFallback;
  if (search.isPending) return <SkeletonRows rows={6} />;
  if (search.isError && results.length === 0) {
    return <ErrorState error={search.error} onRetry={() => void search.refetch()} />;
  }
  if (results.length === 0) {
    return (
      <EmptyState
        icon={<SearchX />}
        title={t("search.noResults.title", { query: props.displayQuery ?? props.query })}
        message={t("search.noResults.message")}
      />
    );
  }
  const sortActions = sortOptions.map((option) => ({
    id: option,
    label: t(`search.sort.${option}`),
    ...(activeSort === option ? { icon: <Check aria-hidden /> } : {}),
    onAction: () => {
      setSelectedSort(option);
    },
  }));
  return (
    <div aria-busy={search.isFetching || undefined}>
      <div className={styles.resultsBar}>
        <p className={styles.total} role="status">
          {savedOnly && hasNextPage
            ? t("account.repositories.savedOnly")
            : t("search.total", { count: total, formatted: formatters.number(total) })}
        </p>
        {sortActions.length > 0 && !savedOnly ? (
          <Menu label={t("search.sort.label")} placement="bottom end" actions={sortActions}>
            <AriaButton className={moduleClass(styles.sortButton)}>
              <ArrowDownWideNarrow aria-hidden />
              <span>{t(`search.sort.${activeSort}`)}</span>
              <ChevronDown aria-hidden />
            </AriaButton>
          </Menu>
        ) : null}
      </div>
      <VirtualList
        label={t("search.resultsLabel")}
        items={results}
        getKey={resultPath}
        estimateSize={estimateResult}
        renderItem={(result: SearchResult) => <SearchResultRow result={result} />}
        separators
        isComplete={!hasNextPage}
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
