import type { LanguageRegistration } from "shiki/core";

export const TOKEN_KINDS = [
  "keyword",
  "string",
  "string-expression",
  "constant",
  "function",
  "parameter",
  "comment",
  "punctuation",
  "link",
  "inserted",
  "deleted",
  "changed",
] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface CodeToken {
  text: string;
  kind: TokenKind | null;
}

export type HighlightedLine = readonly CodeToken[];

/** IIFE workers cannot code-split grammars. */
export interface HighlightRequest {
  id: number;
  code: string;
  language: string;
  grammar: readonly LanguageRegistration[] | null;
}

export type HighlightResponse =
  { id: number; lines: readonly HighlightedLine[] | null } | { id: number; error: string };
