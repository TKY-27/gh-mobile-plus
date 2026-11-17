import { createCssVariablesTheme, createHighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  TOKEN_KINDS,
  type CodeToken,
  type HighlightedLine,
  type HighlightRequest,
  type HighlightResponse,
  type TokenKind,
} from "./tokens.ts";

const THEME = "ghm";
const VARIABLE_PREFIX = "--ghm-code-";
// Minified one-liners would stall the queue.
const MAX_TOKENIZED_LINE_LENGTH = 2000;

const highlighter = createHighlighterCore({
  themes: [
    createCssVariablesTheme({ name: THEME, variablePrefix: VARIABLE_PREFIX, fontStyle: false }),
  ],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});
const queue: HighlightRequest[] = [];
const cancelled = new Set<number>();
let draining = false;

function kindOf(token: ThemedToken): TokenKind | null {
  const name = token.color?.slice(`var(${VARIABLE_PREFIX}token-`.length, -1);
  return TOKEN_KINDS.find((kind) => kind === name) ?? null;
}

function compact(line: readonly ThemedToken[]): HighlightedLine {
  const tokens: CodeToken[] = [];
  for (const token of line) {
    const kind = kindOf(token);
    const previous = tokens.at(-1);
    if (previous?.kind === kind)
      tokens[tokens.length - 1] = { kind, text: previous.text + token.content };
    else tokens.push({ kind, text: token.content });
  }
  return tokens;
}

async function loadGrammar(request: HighlightRequest): Promise<void> {
  if (request.grammar) await (await highlighter).loadLanguage(...request.grammar);
}

async function highlight(request: HighlightRequest): Promise<HighlightResponse> {
  try {
    await loadGrammar(request);
    const core = await highlighter;
    if (!core.getLoadedLanguages().includes(request.language))
      return { id: request.id, lines: null };
    const lines = core.codeToTokensBase(request.code, {
      lang: request.language,
      theme: THEME,
      tokenizeMaxLineLength: MAX_TOKENIZED_LINE_LENGTH,
    });
    return { id: request.id, lines: lines.map(compact) };
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}

// Yielding between requests lets cancel messages arrive.
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  for (let request = queue.shift(); request; request = queue.shift()) {
    const skip = cancelled.has(request.id);
    for (const id of cancelled) if (id <= request.id) cancelled.delete(id);
    if (skip) await loadGrammar(request).catch(reportError);
    else self.postMessage(await highlight(request), {});
    await new Promise((resolve) => setTimeout(resolve));
  }
  draining = false;
}

self.addEventListener("message", (event: MessageEvent<HighlightRequest | { cancel: number }>) => {
  const message = event.data;
  if ("cancel" in message) {
    cancelled.add(message.cancel);
    return;
  }
  queue.push(message);
  void drain();
});
