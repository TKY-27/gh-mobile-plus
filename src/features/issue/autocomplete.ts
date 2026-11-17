export type CompletionTrigger = "@" | "#";

export interface CompletionQuery {
  trigger: CompletionTrigger;
  query: string;
  start: number;
  end: number;
}

// Ignore mentions embedded in other words.
const TOKEN_BEFORE_CARET = /(?:^|[\s([{])([@#])([\w-]{0,39})$/;
const WORD_CHARACTER = /[\w-]/;

export function completionAt(text: string, caret: number): CompletionQuery | null {
  if (WORD_CHARACTER.test(text.charAt(caret))) return null;
  const match = TOKEN_BEFORE_CARET.exec(text.slice(0, caret));
  const trigger = match?.[1];
  const query = match?.[2];
  if ((trigger !== "@" && trigger !== "#") || query === undefined) return null;
  return { trigger, query, start: caret - query.length - 1, end: caret };
}

export function applyCompletion(
  text: string,
  completion: CompletionQuery,
  value: string,
): { text: string; caret: number } {
  const inserted = `${completion.trigger}${value} `;
  const after = text.slice(completion.end).replace(/^ /, "");
  return {
    text: text.slice(0, completion.start) + inserted + after,
    caret: completion.start + inserted.length,
  };
}
