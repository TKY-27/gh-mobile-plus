import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import { MINUTE_MS, SECOND_MS } from "@/ui/time.ts";
import type { Catalog } from "./en.ts";

export type Language = "en" | "ja";
export type LanguagePreference = "system" | Language;

type Namespace = keyof Catalog;
type CatalogKey = {
  [N in Namespace]: `${N}.${Extract<keyof Catalog[N], string>}`;
}[Namespace];
type PluralBase<K extends string> = K extends `${infer Base}.${Intl.LDMLPluralRule}` ? Base : never;

export type MessageKey = CatalogKey | PluralBase<CatalogKey>;
export type MessageParams = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface Formatters {
  number(value: number): string;
  compactNumber(value: number): string;
  relativeTime(date: Date, now: number): string;
  dateTime(date: Date): string;
}

interface I18nValue {
  language: Language;
  t: Translate;
  formatters: Formatters;
}

const SUPPORTED: readonly Language[] = ["en", "ja"];
const PLACEHOLDER = /\{(\w+)\}/g;
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", MINUTE_MS / SECOND_MS],
  ["second", 1],
];

export function resolveLanguage(
  preference: LanguagePreference,
  systemLanguages: readonly string[],
): Language {
  if (preference !== "system") return preference;
  for (const tag of systemLanguages) {
    const base = tag.toLowerCase().split("-")[0];
    const match = SUPPORTED.find((language) => language === base);
    if (match) return match;
  }
  return "en";
}

const catalogs = new Map<Language, Promise<ReadonlyMap<string, string>>>();

function flatten(catalog: Catalog): ReadonlyMap<string, string> {
  const messages = new Map<string, string>();
  for (const [namespace, entries] of Object.entries(catalog)) {
    for (const [key, message] of Object.entries<string>(entries)) {
      messages.set(`${namespace}.${key}`, message);
    }
  }
  return messages;
}

export function loadMessages(language: Language): Promise<ReadonlyMap<string, string>> {
  let pending = catalogs.get(language);
  if (!pending) {
    pending = (language === "ja" ? import("./ja.ts") : import("./en.ts")).then((module) =>
      flatten(module.default),
    );
    catalogs.set(language, pending);
  }
  return pending;
}

export function createTranslator(
  language: Language,
  messages: ReadonlyMap<string, string>,
): Translate {
  const plurals = new Intl.PluralRules(language);
  const numbers = new Intl.NumberFormat(language);
  return (key, params) => {
    const count = params?.count;
    const message =
      (typeof count === "number"
        ? (messages.get(`${key}.${plurals.select(count)}`) ?? messages.get(`${key}.other`))
        : undefined) ?? messages.get(key);
    if (message === undefined) throw new Error(`Missing message "${key}"`);
    if (!params) return message;
    return message.replace(PLACEHOLDER, (_, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`Missing parameter "${name}" for "${key}"`);
      return typeof value === "number" ? numbers.format(value) : value;
    });
  };
}

function createFormatters(language: Language): Formatters {
  const numbers = new Intl.NumberFormat(language);
  const compact = new Intl.NumberFormat(language, { notation: "compact" });
  const relative = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  return {
    number: (value) => numbers.format(value),
    compactNumber: (value) => compact.format(value),
    dateTime: (date) => dates.format(date),
    relativeTime(date, now) {
      const seconds = Math.round((date.getTime() - now) / SECOND_MS);
      const [unit, size] = RELATIVE_UNITS.find(([, length]) => Math.abs(seconds) >= length) ?? [
        "second",
        1,
      ];
      return relative.format(Math.trunc(seconds / size), unit);
    },
  };
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider(props: { language: Language; children: ReactNode }) {
  const messages = use(loadMessages(props.language));
  const value = useMemo(
    () => ({
      language: props.language,
      t: createTranslator(props.language, messages),
      formatters: createFormatters(props.language),
    }),
    [props.language, messages],
  );
  useEffect(() => {
    document.documentElement.lang = props.language;
  }, [props.language]);
  return <I18nContext value={value}>{props.children}</I18nContext>;
}

function useI18n(): I18nValue {
  const value = use(I18nContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}

export function useT(): Translate {
  return useI18n().t;
}

export function useFormatters(): Formatters {
  return useI18n().formatters;
}

export function useLanguage(): Language {
  return useI18n().language;
}
