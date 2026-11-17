import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ImageOff } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components/Tabs";
import { useSoftKeyboardOpen } from "@/app/keyboard.ts";
import { useComposerActive } from "@/app/updates.ts";
import { toAppPath } from "@/data/links";
import { useRenderMarkdown } from "@/data/repo";
import { useIsOffline } from "@/data/status";
import type { RepoRef } from "@/data/types";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { SafeHtml } from "@/markdown/SafeHtml.tsx";
import { Button } from "@/ui/Button.tsx";
import { describeError, ErrorState } from "@/ui/ErrorState.tsx";
import { isOrgAccessRestricted } from "@/ui/error-toast.ts";
import { useNow } from "@/ui/RelativeTime.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Spinner } from "@/ui/Spinner.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { applyCompletion, completionAt } from "./autocomplete.ts";
import { Completions } from "./Completions.tsx";
import styles from "./Composer.module.css";

type ComposerTab = "write" | "preview";

export function useCurrentDraft<T>(draft: T) {
  const current = useRef(draft);
  useLayoutEffect(() => {
    current.current = draft;
  }, [draft]);
  return current;
}

export interface ComposerProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  repo: RepoRef;
  number: number | null;
  submitLabel: string;
  onSubmit: () => void;
  isPending: boolean;
  pinned?: boolean;
  allowEmpty?: boolean;
  secondaryAction?: ReactNode;
  children?: ReactNode;
}

/** Compact, so forms stay usable. */
function PreviewError(props: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const formatters = useFormatters();
  const now = useNow();
  const text = describeError(t, formatters, props.error, now);
  return (
    <p className={styles.previewError} role="alert">
      <span>
        <strong>{text.title}</strong> {text.message}
      </span>
      <Button variant="plain" onPress={props.onRetry}>
        {t("common.retry")}
      </Button>
    </p>
  );
}

export function MarkdownPreview(props: { text: string; repo: RepoRef }) {
  const t = useT();
  const router = useRouter();
  const offline = useIsOffline();
  const { mutate, ...render } = useRenderMarkdown();
  const { text } = props;
  const { owner, name } = props.repo;
  const renderPreview = useCallback(() => {
    if (text.trim() !== "") mutate({ text, repo: { owner, name } });
  }, [mutate, text, owner, name]);

  useEffect(renderPreview, [renderPreview]);

  if (text.trim() === "") {
    return <p className={styles.previewEmpty}>{t("issue.composer.nothingToPreview")}</p>;
  }
  if (render.isError) {
    return isOrgAccessRestricted(render.error) ? (
      <ErrorState error={render.error} onRetry={renderPreview} />
    ) : (
      <PreviewError error={render.error} onRetry={renderPreview} />
    );
  }
  if (render.isPending || render.data === undefined || render.variables.text !== text) {
    return (
      <div className={styles.previewPending}>
        <Spinner size="small" />
      </div>
    );
  }
  return (
    <SafeHtml
      html={render.data}
      className={moduleClass(styles.preview)}
      toAppPath={toAppPath}
      onNavigate={(appPath) => {
        router.history.push(appPath);
      }}
      offline={offline}
      offlineImageLabel={t("issue.offlineImage")}
    />
  );
}

export function Composer(props: ComposerProps) {
  const t = useT();
  const hintId = useId();
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const keyboardOpen = useSoftKeyboardOpen();
  const [tab, setTab] = useState<ComposerTab>("write");
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const { value, onChange } = props;
  const pinned = props.pinned ?? false;
  const expanded = !pinned || focused || value !== "" || tab === "preview";
  const completion = focused ? completionAt(value, caret) : null;
  const showCompletions = completion !== null && completion.start !== dismissedAt;
  const canSubmit = (props.allowEmpty ?? false) || value.trim() !== "";
  useComposerActive(value.trim() !== "");

  const syncCaret = () => {
    setCaret(textarea.current?.selectionStart ?? 0);
  };

  const pick = (completionValue: string) => {
    if (!completion) return;
    const next = applyCompletion(value, completion, completionValue);
    onChange(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      textarea.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div
      className={styles.composer}
      data-pinned={pinned || undefined}
      data-expanded={expanded || undefined}
      data-keyboard-open={keyboardOpen || undefined}
    >
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => {
          setTab(key === "preview" ? "preview" : "write");
        }}
        className={moduleClass(styles.tabs)}
      >
        {/* Panels require mounted tabs. */}
        <TabList
          aria-label={props.label}
          className={moduleClass(expanded ? styles.tabList : styles.collapsedTabs)}
        >
          <Tab id="write" className={moduleClass(styles.tab)}>
            {t("issue.composer.write")}
          </Tab>
          <Tab id="preview" className={moduleClass(styles.tab)}>
            {t("issue.composer.preview")}
          </Tab>
        </TabList>
        <TabPanel id="write" className={moduleClass(styles.panel)}>
          <div className={styles.field}>
            {showCompletions ? (
              <Completions
                completion={completion}
                repo={props.repo}
                number={props.number}
                textarea={textarea}
                onPick={pick}
                onDismiss={() => {
                  setDismissedAt(completion.start);
                }}
              />
            ) : null}
            <textarea
              ref={textarea}
              className={styles.textarea}
              aria-label={props.label}
              aria-describedby={expanded ? hintId : undefined}
              aria-autocomplete="list"
              placeholder={props.placeholder}
              value={value}
              rows={expanded ? 4 : 1}
              enterKeyHint="enter"
              onChange={(event) => {
                onChange(event.target.value);
                setCaret(event.target.selectionStart);
              }}
              onSelect={syncCaret}
              onFocus={() => {
                setFocused(true);
                syncCaret();
              }}
              onBlur={() => {
                setFocused(false);
              }}
              onKeyDown={(event) => {
                if (event.defaultPrevented) return;
                const submitShortcut = event.key === "Enter" && (event.metaKey || event.ctrlKey);
                if (submitShortcut && canSubmit && !props.isPending) {
                  event.preventDefault();
                  props.onSubmit();
                }
              }}
              onPaste={(event) => {
                if (event.clipboardData.files.length > 0) {
                  showToast(t("issue.composer.imagePasteHint"));
                }
              }}
            />
          </div>
        </TabPanel>
        <TabPanel id="preview" className={moduleClass(styles.panel)}>
          <MarkdownPreview text={value} repo={props.repo} />
        </TabPanel>
      </Tabs>
      {props.children}
      {expanded ? (
        <div className={styles.footer}>
          <p id={hintId} className={styles.hint}>
            <ImageOff aria-hidden />
            {t("issue.composer.imageHint")}
          </p>
          <div className={styles.actions}>
            {props.secondaryAction}
            <Button
              variant="primary"
              isPending={props.isPending}
              isDisabled={!canSubmit}
              onPress={props.onSubmit}
            >
              {props.submitLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
