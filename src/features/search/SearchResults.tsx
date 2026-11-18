import { type ReactNode, useCallback } from "react";
import { SearchX } from "lucide-react";
import { useSearch, type SearchResult, type SearchScope } from "@/data/search";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { estimateResult, resultPath, SearchResultRow } from "./SearchResultRow.tsx";
import styles from "./SearchScreen.module.css";

export function SearchResults(props: {
  scope: SearchScope;
  query: string;
  displayQuery?: string;
  offlineFallback?: ReactNode;
}) {
  const t = useT();
  const formatters = useFormatters();
  const savedOnly = Boolean(props.offlineFallback);
  const search = useSearch(props.scope, props.query, !savedOnly);
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
  return (
    <div aria-busy={search.isFetching || undefined}>
      <p className={styles.total} role="status">
        {savedOnly && hasNextPage
          ? t("account.repositories.savedOnly")
          : t("search.total", { count: total, formatted: formatters.number(total) })}
      </p>
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
