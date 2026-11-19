import { useDeferredValue, useState } from "react";
import { Check, GitBranch, ListFilter, Tag } from "lucide-react";
import { qualifiedRef, refKind, refName } from "@/data/links";
import { MAX_REFS_PER_KIND, useFilteredRefs } from "@/data/repo";
import { useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { SearchField } from "@/ui/SearchField.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import styles from "./RefSheet.module.css";

export function RefSheet(props: {
  owner: string;
  repo: string;
  current: string;
  branchesOnly?: boolean;
  onSelect: (ref: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [pickedKind, setKind] = useState<"branches" | "tags" | null>(null);
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter.trim());
  const results = useFilteredRefs(props.owner, props.repo, search);
  const currentKind =
    refKind(props.current) ??
    (results.data?.tags.includes(props.current) && !results.data.branches.includes(props.current)
      ? "tags"
      : "branches");
  const kind = props.branchesOnly ? "branches" : (pickedKind ?? currentKind);
  const names = results[kind];
  const Icon = kind === "branches" ? GitBranch : Tag;

  let list;
  if (results.isPending) list = <Spinner />;
  else if (results.isError)
    list = <ErrorState error={results.error} onRetry={() => void results.refetch()} />;
  else if (names.length === 0) {
    list = (
      <EmptyState
        icon={<Icon />}
        title={t(kind === "branches" ? "repo.refs.noBranches" : "repo.refs.noTags")}
        message={t(search ? "repo.refs.noMatchesMessage" : "repo.refs.noneMessage")}
      />
    );
  } else {
    list = (
      <ListSection>
        {names.map((name) => (
          <ListRow
            key={name}
            leading={<Icon aria-hidden />}
            title={name}
            trailing={
              kind === currentKind && name === refName(props.current) ? (
                <Check className={styles.check} aria-label={t("repo.refs.current")} />
              ) : undefined
            }
            onPress={() => {
              props.onSelect(qualifiedRef(kind, name));
            }}
          />
        ))}
      </ListSection>
    );
  }

  return (
    <Sheet
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
      title={t(props.branchesOnly ? "repo.refs.branches" : "repo.refs.title")}
    >
      <div className={styles.controls}>
        {props.branchesOnly ? null : (
          <SegmentedControl
            label={t("repo.refs.kind")}
            segments={[
              { id: "branches", label: t("repo.refs.branches") },
              { id: "tags", label: t("repo.refs.tags") },
            ]}
            selected={kind}
            onChange={setKind}
          />
        )}
        <SearchField
          label={t("repo.refs.filter")}
          placeholder={t("repo.refs.filter")}
          value={filter}
          onChange={setFilter}
        />
        {results.data?.truncated ? (
          <Banner icon={<ListFilter />}>
            {t("repo.refs.limited", { limit: MAX_REFS_PER_KIND })}
          </Banner>
        ) : null}
      </div>
      {list}
    </Sheet>
  );
}
