import { lazy, Suspense, useState } from "react";
import { Play, SlidersHorizontal, Workflow } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { actionsRoute } from "@/app/router.ts";
import { useWorkflowRuns, type RunFilters } from "@/data/actions";
import { useT } from "@/i18n/index.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { InfiniteList } from "@/ui/VirtualList.tsx";
import { activeFilterCount, NO_FILTERS, RunFilterSheet } from "./RunFilterSheet.tsx";
import { RUN_ROW_ESTIMATE_PX, RunRow } from "./RunRow.tsx";
import styles from "./Actions.module.css";

const DispatchSheet = lazy(() => import("./DispatchSheet.tsx"));

export default function RunsScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(actionsRoute);
  const [filters, setFilters] = useState<RunFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const query = useWorkflowRuns(owner, repo, filters);
  const filterCount = activeFilterCount(filters);
  const title = t("actions.runs.title");

  return (
    <Page
      title={title}
      largeTitle
      actions={
        <>
          <IconButton
            label={t("actions.dispatch.open")}
            onPress={() => {
              setDispatchOpen(true);
            }}
          >
            <Play aria-hidden />
          </IconButton>
          <span className={styles.filterButton}>
            <IconButton
              label={
                filterCount > 0
                  ? t("actions.filters.openActive", { count: filterCount })
                  : t("actions.filters.open")
              }
              onPress={() => {
                setFiltersOpen(true);
              }}
            >
              <SlidersHorizontal aria-hidden />
            </IconButton>
            {filterCount > 0 ? (
              <span className={styles.filterDot} aria-hidden>
                {filterCount}
              </span>
            ) : null}
          </span>
        </>
      }
    >
      <p className={styles.repoLine}>
        {owner}/{repo}
      </p>
      <InfiniteList
        query={query}
        label={title}
        estimateSize={RUN_ROW_ESTIMATE_PX}
        getKey={(run) => run.id}
        renderItem={(run) => <RunRow owner={owner} repo={repo} run={run} />}
        empty={
          filterCount > 0 ? (
            <EmptyState
              icon={<SlidersHorizontal />}
              title={t("actions.runs.noMatches")}
              message={t("actions.runs.noMatchesMessage")}
              action={
                <Button
                  onPress={() => {
                    setFilters(NO_FILTERS);
                  }}
                >
                  {t("actions.filters.clear")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Workflow />}
              title={t("actions.runs.empty")}
              message={t("actions.runs.emptyMessage")}
            />
          )
        }
      />
      {filtersOpen ? (
        <RunFilterSheet
          owner={owner}
          repo={repo}
          isOpen
          onOpenChange={setFiltersOpen}
          filters={filters}
          onChange={setFilters}
        />
      ) : null}
      <Suspense fallback={null}>
        {dispatchOpen ? (
          <DispatchSheet
            owner={owner}
            repo={repo}
            initialWorkflowId={filters.workflowId}
            onOpenChange={setDispatchOpen}
          />
        ) : null}
      </Suspense>
    </Page>
  );
}
