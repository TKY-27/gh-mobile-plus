import { useEffect, useState } from "react";
import type { LanguageRegistration } from "shiki/core";
import type { HighlightedLine, HighlightRequest, HighlightResponse } from "./tokens.ts";

export type { CodeToken, HighlightedLine, TokenKind } from "./tokens.ts";

// Keep grammars aligned with language detection.
const GRAMMARS: Readonly<
  Record<string, () => Promise<{ default: readonly LanguageRegistration[] }>>
> = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  clojure: () => import("shiki/langs/clojure.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  erlang: () => import("shiki/langs/erlang.mjs"),
  fish: () => import("shiki/langs/fish.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  haskell: () => import("shiki/langs/haskell.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  zsh: () => import("shiki/langs/zsh.mjs"),
};

interface Waiter {
  resolve: (lines: readonly HighlightedLine[] | null) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const waiters = new Map<number, Waiter>();
const sentGrammars = new Set<string>();

function highlightWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./highlight.worker.ts", import.meta.url), {
    type: "module",
    name: "highlight",
  });
  created.addEventListener("message", (event: MessageEvent<HighlightResponse>) => {
    const response = event.data;
    const waiter = waiters.get(response.id);
    waiters.delete(response.id);
    if ("error" in response) waiter?.reject(new Error(response.error));
    else waiter?.resolve(response.lines);
  });
  created.addEventListener("error", (event) => {
    for (const waiter of waiters.values()) waiter.reject(new Error(event.message));
    waiters.clear();
  });
  worker = created;
  return created;
}

export async function highlightLines(
  lines: readonly string[],
  language: string,
  signal: AbortSignal,
): Promise<readonly HighlightedLine[] | null> {
  const load = GRAMMARS[language];
  if (!load) return null;
  const grammar = sentGrammars.has(language) ? null : (await load()).default;
  signal.throwIfAborted();
  sentGrammars.add(language);
  const id = nextId++;
  const target = highlightWorker();
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    signal.addEventListener("abort", () => {
      if (!waiters.delete(id)) return;
      target.postMessage({ cancel: id });
      reject(signal.reason instanceof Error ? signal.reason : new Error("Highlight aborted"));
    });
    const request: HighlightRequest = { id, code: lines.join("\n"), language, grammar };
    target.postMessage(request);
  });
}

// Unstable lines restart highlighting.
export function useHighlightedLines(
  lines: readonly string[],
  language: string | null,
): readonly HighlightedLine[] | null {
  const [result, setResult] = useState<{
    lines: readonly string[];
    language: string;
    tokens: readonly HighlightedLine[] | null;
  } | null>(null);

  useEffect(() => {
    if (language === null) return;
    const controller = new AbortController();
    highlightLines(lines, language, controller.signal).then(
      (tokens) => {
        setResult({ lines, language, tokens });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) reportError(error);
      },
    );
    return () => {
      controller.abort();
    };
  }, [lines, language]);

  return result?.lines === lines && result.language === language ? result.tokens : null;
}
