import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRightToLine,
  IndentDecrease,
  IndentIncrease,
  Redo2,
  Search,
  Undo2,
} from "lucide-react";
import { Toolbar } from "react-aria-components/Toolbar";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  insertTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import { useT, type Translate } from "@/i18n/index.tsx";
import { IconButton } from "../Button.tsx";
import { moduleClass } from "../module-class.ts";
import type { CodeEditorProps } from "./CodeEditor.tsx";
import { highlightLines } from "./highlight.ts";
import { TOKEN_KINDS, type HighlightedLine, type TokenKind } from "./tokens.ts";
import tokenStyles from "./code.module.css";
import styles from "./editor.module.css";

const HIGHLIGHT_DELAY_MS = 300;
const DEFAULT_INDENT = "  ";
const LEADING_SPACES = /^( {2,8})\S/m;
const LEADING_TAB = /^\t/m;
const TOOLBAR_CLEARANCE_PX = 64;

const tokenMarks = new Map<TokenKind, Decoration>(
  TOKEN_KINDS.map((kind) => [
    kind,
    Decoration.mark({ class: moduleClass(tokenStyles.token), attributes: { "data-kind": kind } }),
  ]),
);

const setHighlight = StateEffect.define<DecorationSet>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHighlight)) return effect.value;
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function decorationsFor(doc: Text, lines: readonly HighlightedLine[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  lines.forEach((tokens, index) => {
    if (index >= doc.lines) return;
    const line = doc.line(index + 1);
    let position = line.from;
    for (const token of tokens) {
      const end = Math.min(position + token.text.length, line.to);
      const mark = token.kind ? tokenMarks.get(token.kind) : undefined;
      if (mark && end > position) builder.add(position, end, mark);
      position = end;
    }
  });
  return builder.finish();
}

function shikiHighlighting(language: string): Extension {
  const plugin = ViewPlugin.define((view) => {
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const run = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const doc = view.state.doc;
      highlightLines(doc.toJSON(), language, current.signal).then(
        (lines) => {
          if (lines && view.state.doc === doc) {
            view.dispatch({ effects: setHighlight.of(decorationsFor(doc, lines)) });
          }
        },
        (error: unknown) => {
          if (!current.signal.aborted) reportError(error);
        },
      );
    };
    run();
    return {
      update(update) {
        if (!update.docChanged) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(run, HIGHLIGHT_DELAY_MS);
      },
      destroy() {
        window.clearTimeout(timer);
        controller?.abort();
      },
    };
  });
  return [highlightField, plugin];
}

function detectIndent(text: string): string {
  if (LEADING_TAB.test(text)) return "\t";
  return LEADING_SPACES.exec(text)?.[1] ?? DEFAULT_INDENT;
}

function searchPhrases(t: Translate): Record<string, string> {
  return {
    Find: t("code.editor.search.find"),
    Replace: t("code.editor.search.replace"),
    next: t("code.editor.search.next"),
    previous: t("code.editor.search.previous"),
    all: t("code.editor.search.all"),
    "match case": t("code.editor.search.matchCase"),
    regexp: t("code.editor.search.regexp"),
    "by word": t("code.editor.search.byWord"),
    replace: t("code.editor.search.replaceOne"),
    "replace all": t("code.editor.search.replaceAll"),
    close: t("code.editor.search.close"),
  };
}

const editorTheme = EditorView.theme({
  "&": { color: "var(--color-text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { caretColor: "var(--accent)", fontFamily: "var(--font-mono)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "var(--accent-soft)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text-tertiary)",
    borderRight: "var(--border-width) solid var(--color-separator)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent)" },
  ".cm-panels": {
    zIndex: "1",
    backgroundColor: "var(--color-bg-secondary)",
    color: "var(--color-text)",
  },
  ".cm-panels-top": { top: "calc(var(--nav-bar-height) + env(safe-area-inset-top))" },
  ".cm-panel.cm-search [name=close]": { position: "static", marginInlineStart: "auto" },
  ".cm-panels.cm-panels-top": { borderBottom: "var(--border-width) solid var(--color-separator)" },
});

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export default function Editor(props: CodeEditorProps) {
  const t = useT();
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const wrapping = useRef(new Compartment());
  const onChange = useLatest(props.onChange);
  const mount = useLatest({ ...props, t });
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const { initialValue: value, softWrap, language, label } = mount.current;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          drawSelection(),
          history(),
          search({ top: true }),
          indentUnit.of(detectIndent(value)),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          wrapping.current.of(softWrap ? EditorView.lineWrapping : []),
          language ? shikiHighlighting(language) : [],
          editorTheme,
          EditorState.phrases.of(searchPhrases(mount.current.t)),
          EditorView.contentAttributes.of({
            "aria-label": label,
            autocapitalize: "off",
            autocorrect: "off",
            spellcheck: "false",
          }),
          EditorView.scrollMargins.of(() => ({ bottom: TOOLBAR_CLEARANCE_PX })),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange.current(update.state.doc.toString());
            if (update.transactions.length > 0) {
              setDepth({ undo: undoDepth(update.state), redo: redoDepth(update.state) });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [mount, onChange]);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapping.current.reconfigure(props.softWrap ? EditorView.lineWrapping : []),
    });
  }, [props.softWrap]);

  const tools = [
    { label: t("code.editor.tab"), icon: ArrowRightToLine, command: insertTab, enabled: true },
    { label: t("code.editor.outdent"), icon: IndentDecrease, command: indentLess, enabled: true },
    { label: t("code.editor.indent"), icon: IndentIncrease, command: indentMore, enabled: true },
    { label: t("code.editor.undo"), icon: Undo2, command: undo, enabled: depth.undo > 0 },
    { label: t("code.editor.redo"), icon: Redo2, command: redo, enabled: depth.redo > 0 },
    { label: t("code.editor.find"), icon: Search, command: openSearchPanel, enabled: true },
  ];

  return (
    <div className={styles.editor} data-keyboard-open={props.keyboardOpen || undefined}>
      <div ref={host} className={styles.host} />
      <Toolbar aria-label={t("code.editor.tools")} className={moduleClass(styles.toolbar)}>
        {tools.map(({ label, icon: Icon, command, enabled }) => (
          <IconButton
            key={label}
            label={label}
            preventFocusOnPress
            isDisabled={!enabled}
            onPress={() => {
              if (view.current) command(view.current);
            }}
          >
            <Icon aria-hidden />
          </IconButton>
        ))}
      </Toolbar>
    </div>
  );
}
