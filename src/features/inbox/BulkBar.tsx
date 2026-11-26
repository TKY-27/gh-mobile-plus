import { Check, MailOpen } from "lucide-react";
import { ProgressBar } from "react-aria-components/ProgressBar";
import type { BulkProgress } from "@/data/inbox";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import type { SwipeAction } from "./swipe.ts";
import styles from "./BulkBar.module.css";

export interface BulkRun {
  action: SwipeAction;
  progress: BulkProgress;
}

function outcomeText(t: ReturnType<typeof useT>, run: BulkRun): string {
  const { progress } = run;
  const processed = progress.done + progress.failed;
  if (progress.stoppedByRateLimit) {
    return t("inbox.bulk.stopped", { done: progress.done, total: progress.total });
  }
  if (progress.failed > 0) {
    return t("inbox.bulk.partial", {
      done: progress.done,
      failed: progress.failed,
      total: processed,
    });
  }
  return t(run.action === "done" ? "inbox.bulk.doneAll" : "inbox.bulk.readAll", {
    count: progress.done,
  });
}

export function BulkBar(props: {
  selectedCount: number;
  offline: boolean;
  run: BulkRun | null;
  onRun: (action: SwipeAction) => void;
}) {
  const t = useT();
  const { run } = props;
  const running = run?.progress.running ?? false;
  const disabled = props.offline || running || props.selectedCount === 0;
  return (
    <div className={styles.bar} role="group" aria-label={t("inbox.bulk.label")}>
      {run?.progress.running ? (
        <ProgressBar
          value={run.progress.done + run.progress.failed}
          maxValue={run.progress.total}
          className={moduleClass(styles.progress)}
          aria-label={t(
            run.action === "done" ? "inbox.bulk.markingDone" : "inbox.bulk.markingRead",
          )}
        >
          {({ percentage }) => (
            <>
              <span className={styles.progressLabel}>
                {t(run.action === "done" ? "inbox.bulk.markingDone" : "inbox.bulk.markingRead")}
                <span className={styles.progressValue}>
                  {t("inbox.bulk.progress", {
                    processed: run.progress.done + run.progress.failed,
                    total: run.progress.total,
                  })}
                </span>
              </span>
              <span className={styles.track} aria-hidden>
                <span
                  className={styles.fill}
                  style={{ transform: `scaleX(${String((percentage ?? 0) / 100)})` }}
                />
              </span>
            </>
          )}
        </ProgressBar>
      ) : (
        <p className={styles.summary} role="status">
          {run ? outcomeText(t, run) : t("inbox.bulk.selected", { count: props.selectedCount })}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          icon={<MailOpen aria-hidden />}
          isDisabled={disabled}
          onPress={() => {
            props.onRun("read");
          }}
        >
          {t("inbox.action.read")}
        </Button>
        <Button
          variant="primary"
          icon={<Check aria-hidden />}
          isDisabled={disabled}
          onPress={() => {
            props.onRun("done");
          }}
        >
          {t("inbox.action.done")}
        </Button>
      </div>
    </div>
  );
}
