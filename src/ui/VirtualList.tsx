import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { useScreen } from "@/app/navigation/screen.ts";
import type { Page } from "@/data/types";
import { ErrorState, isFullScreenError } from "./ErrorState.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { Spinner } from "./Spinner.tsx";
import styles from "./VirtualList.module.css";

const OVERSCAN_ROWS = 8;
const END_REACHED_ROWS = 10;
const SKELETON_ROWS = 8;
const SKELETON_INSET_PX = 8;

export interface VirtualListProps<T> {
  label: string;
  items: readonly T[];
  getKey: (entry: T) => string | number;
  estimateSize: number | ((entry: T) => number);
  renderItem: (entry: T) => ReactNode;
  onEndReached?: (() => void) | undefined;
  isComplete?: boolean;
  focus?: { index: number } | null;
  separators?: boolean;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const { scroller } = useScreen();
  const list = useRef<HTMLUListElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const { items, getKey, estimateSize, onEndReached, focus } = props;

  const measureMargin = useCallback(() => {
    const root = scroller.current;
    const element = list.current;
    // Hidden background tabs have no layout.
    if (!root || !element || root.clientHeight === 0) return;
    const top =
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    setScrollMargin(top);
  }, [scroller]);

  // Content above the list can move it.
  useLayoutEffect(() => {
    const root = scroller.current;
    const element = list.current;
    if (!root || !element) return;
    measureMargin();
    const observer = new ResizeObserver(measureMargin);
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      observer.observe(node);
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        observer.observe(sibling);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, [scroller, measureMargin]);

  // eslint-disable-next-line react-hooks/incompatible-library -- Virtualizer manages memoization
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => {
      const entry = items[index];
      if (entry === undefined) return 0;
      return typeof estimateSize === "number" ? estimateSize : estimateSize(entry);
    },
    getItemKey: (index) => {
      const entry = items[index];
      return entry === undefined ? index : getKey(entry);
    },
    overscan: OVERSCAN_ROWS,
    scrollMargin,
    initialRect: { width: window.innerWidth, height: window.innerHeight },
    observeElementRect: (instance, report) =>
      observeElementRect(instance, (rect) => {
        if (rect.height > 0) report(rect);
      }),
    onChange: measureMargin,
  });
  const rows = virtualizer.getVirtualItems();
  const lastIndex = rows.at(-1)?.index ?? -1;

  useEffect(() => {
    if (items.length > 0 && lastIndex >= items.length - END_REACHED_ROWS) onEndReached?.();
  }, [lastIndex, items.length, onEndReached]);

  useEffect(() => {
    if (focus) virtualizer.scrollToIndex(focus.index, { align: "center" });
  }, [focus, virtualizer]);

  return (
    <ul
      ref={list}
      aria-label={props.label}
      className={styles.list}
      data-separators={props.separators || undefined}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => {
        const entry = items[row.index];
        if (entry === undefined) return null;
        return (
          <li
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            aria-setsize={props.isComplete === false ? -1 : items.length}
            aria-posinset={row.index + 1}
            className={styles.row}
            style={{ transform: `translateY(${String(row.start - scrollMargin)}px)` }}
          >
            {props.renderItem(entry)}
          </li>
        );
      })}
    </ul>
  );
}

export function InfiniteList<T>(props: {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  label: string;
  estimateSize: number;
  getKey: (entry: T) => string | number;
  renderItem: (entry: T) => ReactNode;
  empty: ReactNode;
  separators?: boolean;
}) {
  const { query } = props;
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  const canFetchMore = hasNextPage && !isFetchingNextPage && !isFetchNextPageError;

  if (query.isPending) {
    return (
      <div className={styles.skeleton} aria-busy="true">
        <Spinner size="small" />
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton
            key={index}
            width="100%"
            height={`${String(props.estimateSize - SKELETON_INSET_PX)}px`}
          />
        ))}
      </div>
    );
  }
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (query.isError && items.length === 0) {
    return (
      <ErrorState
        error={query.error}
        fullScreen={isFullScreenError(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (items.length === 0) return props.empty;

  return (
    <>
      <VirtualList
        items={items}
        label={props.label}
        estimateSize={props.estimateSize}
        getKey={props.getKey}
        renderItem={props.renderItem}
        isComplete={!hasNextPage}
        separators={props.separators ?? true}
        onEndReached={canFetchMore ? () => void fetchNextPage() : undefined}
      />
      {isFetchingNextPage ? (
        <div className={styles.footer}>
          <Spinner size="small" />
        </div>
      ) : null}
      {isFetchNextPageError ? (
        <ErrorState error={query.error} onRetry={() => void fetchNextPage()} />
      ) : null}
    </>
  );
}
