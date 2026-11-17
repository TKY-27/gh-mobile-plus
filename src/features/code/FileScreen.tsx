import { useMemo, useState } from "react";
import {
  Copy,
  ExternalLink,
  FileQuestion,
  FileWarning,
  ImageOff,
  Link2,
  ListChecks,
  Pencil,
  WrapText,
  X,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { useScreen, useScreenParams } from "@/app/navigation/screen.ts";
import { blobRoute } from "@/app/router.ts";
import { refName, toAppPath } from "@/data/links";
import { setPreferences, usePreferences } from "@/data/preferences";
import { permalink, useFile, type FileContent } from "@/data/repo";
import { useIsOffline } from "@/data/status";
import { useT } from "@/i18n/index.tsx";
import { SafeHtml } from "@/markdown/SafeHtml.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import type { MenuAction } from "@/ui/Menu.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { openExternal } from "@/ui/external.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { CodeView, type LineRange } from "./CodeView.tsx";
import { SelectLinesSheet } from "./SelectLinesSheet.tsx";
import { editPath } from "./paths.ts";
import { useRefRedirect } from "./ref-redirect.ts";
import { useFormatSize } from "./size.ts";
import styles from "./FileScreen.module.css";

const SKELETON_LINES = 12;
const LINE_HASH = /^#L(\d+)(?:-L(\d+))?$/;

type TextContent = Extract<FileContent, { kind: "text" | "markdown" }>;

function rangeFromHash(href: string): LineRange | null {
  const match = LINE_HASH.exec(new URL(href, window.location.origin).hash);
  if (!match?.[1]) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function splitLines(text: string): readonly string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function copyText(text: string, done: string, failed: string) {
  navigator.clipboard.writeText(text).then(
    () => showToast(done),
    () => showToast(failed),
  );
}

function ImageView(props: { src: string; name: string; size: string }) {
  const t = useT();
  const offline = useIsOffline();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <EmptyState
        icon={<ImageOff />}
        title={t(offline ? "code.image.offline" : "code.image.failed")}
        message={t(offline ? "code.image.offlineMessage" : "code.image.failedMessage")}
      />
    );
  }
  return (
    <figure className={styles.image}>
      <img
        src={props.src}
        alt={props.name}
        decoding="async"
        onError={() => {
          setFailed(true);
        }}
      />
      <figcaption className={styles.caption}>{props.size}</figcaption>
    </figure>
  );
}

function SelectionBar(props: {
  selection: LineRange;
  lines: readonly string[];
  permalink: string;
  onClear: () => void;
}) {
  const t = useT();
  const { start, end } = props.selection;
  const label =
    start === end
      ? t("code.selection.line", { line: start })
      : t("code.selection.lines", { start, end });
  return (
    <div className={styles.selectionBar} role="region" aria-label={t("code.selection.label")}>
      <span className={styles.selectionLabel} aria-live="polite">
        {label}
      </span>
      <IconButton
        label={t("code.selection.copyLines")}
        onPress={() => {
          copyText(
            props.lines.slice(start - 1, end).join("\n"),
            t("code.selection.copiedLines"),
            t("common.copyFailed"),
          );
        }}
      >
        <Copy aria-hidden />
      </IconButton>
      <IconButton
        label={t("code.permalink.copy")}
        onPress={() => {
          copyText(props.permalink, t("code.permalink.copied"), t("common.copyFailed"));
        }}
      >
        <Link2 aria-hidden />
      </IconButton>
      <IconButton label={t("code.selection.clear")} onPress={props.onClear}>
        <X aria-hidden />
      </IconButton>
    </div>
  );
}

function TextFile(props: {
  file: TextContent;
  owner: string;
  repo: string;
  path: string;
  language: string | null;
  selection: LineRange | null;
  onSelectionChange: (selection: LineRange | null) => void;
  scrollToLine: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const offline = useIsOffline();
  const { softWrap } = usePreferences();
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const { file, selection } = props;
  const lines = useMemo(() => splitLines(file.text), [file.text]);
  const shown = selection ? "raw" : view;
  const rendered = file.kind === "markdown" && shown === "rendered";

  return (
    <>
      {file.kind === "markdown" ? (
        <div className={styles.toolbar}>
          <SegmentedControl
            label={t("code.markdown.view")}
            segments={[
              { id: "rendered", label: t("code.markdown.rendered") },
              { id: "raw", label: t("code.markdown.raw") },
            ]}
            selected={shown}
            onChange={(next) => {
              setView(next);
              props.onSelectionChange(null);
            }}
          />
        </div>
      ) : null}
      {rendered ? (
        <SafeHtml
          html={file.html}
          className={moduleClass(styles.markdown)}
          toAppPath={toAppPath}
          onNavigate={(appPath) => {
            router.history.push(appPath);
          }}
          offline={offline}
          offlineImageLabel={t("code.image.offline")}
        />
      ) : (
        <CodeView
          lines={lines}
          language={props.language}
          softWrap={softWrap}
          selection={selection}
          onSelectionChange={props.onSelectionChange}
          scrollToLine={props.scrollToLine}
        />
      )}
      {selection && !rendered ? (
        <SelectionBar
          selection={selection}
          lines={lines}
          permalink={permalink(props.owner, props.repo, file.headOid, props.path, selection)}
          onClear={() => {
            props.onSelectionChange(null);
          }}
        />
      ) : null}
    </>
  );
}

export default function FileScreen() {
  const t = useT();
  const router = useRouter();
  const formatSize = useFormatSize();
  const { href } = useScreen();
  const { owner, repo, ref: urlRef, _splat: path = "" } = useScreenParams(blobRoute);
  const redirect = useRefRedirect("blob", owner, repo, urlRef, path);
  const ref = redirect.ref;
  const file = useFile(owner, repo, ref, path, redirect.ready);
  const { softWrap } = usePreferences();
  const [initialRange] = useState(() => rangeFromHash(href));
  const [selection, setSelection] = useState<LineRange | null>(initialRange);
  const [selectingLines, setSelectingLines] = useState(false);
  const name = path.split("/").at(-1) ?? path;
  const textFile =
    redirect.ready && (file.data?.kind === "text" || file.data?.kind === "markdown")
      ? file.data
      : null;
  const error = redirect.error ?? (redirect.ready ? file.error : null);

  const menuActions: MenuAction[] = [];
  if (textFile) {
    menuActions.push(
      {
        id: "permalink",
        label: t("code.permalink.copy"),
        icon: <Link2 aria-hidden />,
        onAction: () => {
          copyText(
            permalink(owner, repo, textFile.headOid, path, selection ?? undefined),
            t("code.permalink.copied"),
            t("common.copyFailed"),
          );
        },
      },
      {
        id: "select-lines",
        label: t("code.selection.select"),
        icon: <ListChecks aria-hidden />,
        onAction: () => {
          setSelectingLines(true);
        },
      },
      {
        id: "soft-wrap",
        label: t(softWrap ? "code.wrap.off" : "code.wrap.on"),
        icon: <WrapText aria-hidden />,
        onAction: () => {
          setPreferences({ softWrap: !softWrap });
        },
      },
    );
  }

  let body;
  if (error) {
    body = (
      <ErrorState
        error={error}
        fullScreen={isFullScreenError(error)}
        onRetry={() => void (redirect.error ? redirect.retry() : file.refetch())}
      />
    );
  } else if (!redirect.ready || file.isPending) {
    body = (
      <div className={styles.skeleton} aria-busy="true">
        {Array.from({ length: SKELETON_LINES }, (_, index) => (
          <Skeleton key={index} width={`${String(40 + ((index * 37) % 55))}%`} height="0.875rem" />
        ))}
      </div>
    );
  } else if (file.data) {
    const content = file.data;
    switch (content.kind) {
      case "text":
      case "markdown":
        body = (
          <TextFile
            file={content}
            owner={owner}
            repo={repo}
            path={path}
            language={content.kind === "text" ? content.language : "markdown"}
            selection={selection}
            onSelectionChange={setSelection}
            scrollToLine={initialRange?.start ?? null}
          />
        );
        break;
      case "image":
        body = <ImageView src={content.src} name={name} size={formatSize(content.size)} />;
        break;
      case "binary":
        body = (
          <EmptyState
            icon={<FileQuestion />}
            title={t("code.binary.title")}
            message={t("code.binary.message", { size: formatSize(content.size) })}
          />
        );
        break;
      case "tooLarge":
        body = (
          <EmptyState
            icon={<FileWarning />}
            title={t("code.tooLarge.title")}
            message={t("code.tooLarge.message", { size: formatSize(content.size) })}
            action={
              <Button
                variant="primary"
                icon={<ExternalLink aria-hidden />}
                onPress={() => {
                  openExternal(content.rawUrl);
                }}
              >
                {t("code.tooLarge.openRaw")}
              </Button>
            }
          />
        );
        break;
    }
  }

  return (
    <Page
      title={name}
      menuActions={menuActions}
      actions={
        textFile?.onBranch ? (
          <IconButton
            label={t("code.edit.action")}
            onPress={() => {
              router.history.push(editPath(owner, repo, refName(ref), path));
            }}
          >
            <Pencil aria-hidden />
          </IconButton>
        ) : null
      }
    >
      {redirect.ready ? (
        <Breadcrumb owner={owner} repo={repo} gitRef={ref} path={path} kind="blob" />
      ) : null}
      {textFile ? (
        <p className={styles.meta}>
          {t("code.meta.lines", { count: textFile.lineCount })}
          <span aria-hidden> · </span>
          {formatSize(textFile.size)}
        </p>
      ) : null}
      {body}
      {textFile && selectingLines ? (
        <SelectLinesSheet
          isOpen
          onOpenChange={setSelectingLines}
          lineCount={textFile.lineCount}
          initial={selection}
          onSelect={setSelection}
        />
      ) : null}
    </Page>
  );
}
