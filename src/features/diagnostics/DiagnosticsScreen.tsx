import { useState } from "react";
import { Copy, TriangleAlert } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { runSpikeS1, runSpikeS2, type ProbeResult } from "@/data/diagnostics";
import { useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { Button } from "@/ui/Button.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import styles from "./DiagnosticsScreen.module.css";

function formatResults(results: readonly ProbeResult[], verdict: (ok: boolean) => string): string {
  return results
    .map((result) =>
      [verdict(result.ok), result.name, String(result.status ?? "-"), result.detail].join("\t"),
    )
    .join("\n");
}

export default function DiagnosticsScreen() {
  const t = useT();
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [jobId, setJobId] = useState("");
  const [running, setRunning] = useState<"s1" | "s2" | null>(null);
  const [results, setResults] = useState<readonly ProbeResult[]>([]);

  const run = (spike: "s1" | "s2", probe: () => Promise<readonly ProbeResult[]>) => {
    setRunning(spike);
    probe().then(
      (next) => {
        setResults(next);
        setRunning(null);
      },
      (error: unknown) => {
        setResults([
          {
            name: spike,
            ok: false,
            status: null,
            detail: error instanceof Error ? error.message : String(error),
          },
        ]);
        setRunning(null);
      },
    );
  };

  const verdict = (ok: boolean) => t(ok ? "app.diagnostics.pass" : "app.diagnostics.fail");
  const parsedJobId = jobId.trim() === "" ? null : Number(jobId);
  return (
    <Page title={t("app.diagnostics.title")} openOnGitHub={false}>
      <div className={styles.body}>
        <Banner icon={<TriangleAlert />} tone="warning">
          {t("app.diagnostics.s1Warning")}
        </Banner>
        <Button
          variant="primary"
          isPending={running === "s1"}
          isDisabled={running !== null}
          onPress={() => {
            run("s1", runSpikeS1);
          }}
        >
          {t("app.diagnostics.runS1")}
        </Button>
        <TextField label={t("app.diagnostics.owner")} value={owner} onChange={setOwner} />
        <TextField label={t("app.diagnostics.repo")} value={repo} onChange={setRepo} />
        <TextField
          label={t("app.diagnostics.jobId")}
          description={t("app.diagnostics.jobIdHint")}
          inputMode="numeric"
          value={jobId}
          onChange={setJobId}
        />
        <Button
          variant="primary"
          isPending={running === "s2"}
          isDisabled={running !== null || !owner || !repo || Number.isNaN(parsedJobId)}
          onPress={() => {
            run("s2", () => runSpikeS2({ owner, repo, jobId: parsedJobId }));
          }}
        >
          {t("app.diagnostics.runS2")}
        </Button>
        {results.length > 0 ? (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("app.diagnostics.result")}</th>
                  <th scope="col">{t("app.diagnostics.probe")}</th>
                  <th scope="col">{t("app.diagnostics.status")}</th>
                  <th scope="col">{t("app.diagnostics.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={`${result.name}-${String(index)}`}>
                    <td data-ok={result.ok || undefined}>{verdict(result.ok)}</td>
                    <td>{result.name}</td>
                    <td>{result.status ?? "-"}</td>
                    <td>{result.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              icon={<Copy aria-hidden />}
              onPress={() => {
                navigator.clipboard.writeText(formatResults(results, verdict)).then(
                  () => showToast(t("common.copied")),
                  () => showToast(t("common.copyFailed")),
                );
              }}
            >
              {t("app.diagnostics.copy")}
            </Button>
          </>
        ) : null}
      </div>
    </Page>
  );
}
