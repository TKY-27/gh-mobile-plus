import { useMemo } from "react";
import { VisuallyHidden } from "react-aria-components/VisuallyHidden";
import { diffLines, useLatestFile } from "@/data/commit";
import { useT } from "@/i18n/index.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { sideBySide, type SideCell } from "./side-by-side.ts";
import styles from "./LatestDiff.module.css";

function Cell(props: { cell: SideCell | null; side: "left" | "right" }) {
  const t = useT();
  const { cell, side } = props;
  if (!cell) return <div className={styles.cell} data-empty />;
  const marker = side === "left" ? "−" : "+";
  return (
    <div className={styles.cell} data-side={side} data-changed={cell.changed || undefined}>
      <span className={styles.number} aria-hidden>
        {cell.line}
      </span>
      <span className={styles.marker} aria-hidden>
        {cell.changed ? marker : ""}
      </span>
      {cell.changed ? (
        <VisuallyHidden>
          {t(side === "left" ? "code.conflict.onlyLatest" : "code.conflict.onlyYours")}
        </VisuallyHidden>
      ) : null}
      <code className={styles.text}>{cell.text}</code>
    </div>
  );
}

export function LatestDiff(props: {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
}) {
  const t = useT();
  const latest = useLatestFile(props.owner, props.repo, props.branch, props.path, true);
  const latestText = latest.data?.text;
  const rows = useMemo(
    () => (latestText === undefined ? null : sideBySide(diffLines(latestText, props.content))),
    [latestText, props.content],
  );

  if (latest.isPending) {
    return (
      <div className={styles.loading} aria-busy="true">
        <Skeleton width="100%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="90%" height="1rem" />
      </div>
    );
  }
  if (latest.isError)
    return <ErrorState error={latest.error} onRetry={() => void latest.refetch()} />;
  if (!rows?.some((row) => row.kind === "pair")) {
    return <p className={styles.same}>{t("code.conflict.noDifferences")}</p>;
  }
  return (
    <div className={styles.diff} role="table" aria-label={t("code.conflict.diffLabel")}>
      <div className={styles.row} role="row">
        <span className={styles.heading} role="columnheader">
          {t("code.conflict.latest", { branch: props.branch })}
        </span>
        <span className={styles.heading} role="columnheader">
          {t("code.conflict.yours")}
        </span>
      </div>
      {rows.map((row, index) =>
        row.kind === "gap" ? (
          <div key={index} className={styles.gap} role="row">
            <span role="cell">{t("code.conflict.unchanged", { count: row.hidden })}</span>
          </div>
        ) : (
          <div key={index} className={styles.row} role="row">
            <div role="cell">
              <Cell cell={row.left} side="left" />
            </div>
            <div role="cell">
              <Cell cell={row.right} side="right" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
