import { Fragment, type ReactNode } from "react";
import type { MessageKey, Translate } from "@/i18n/index.tsx";

// Private-use characters never occur in catalogs.
const MARK = "\uE000";
const SLOT = new RegExp(`${MARK}(\\w+)${MARK}`, "u");

// Word order differs across locales.
export function richMessage(
  t: Translate,
  key: MessageKey,
  slots: Readonly<Record<string, ReactNode>>,
): ReactNode {
  const params = Object.fromEntries(Object.keys(slots).map((name) => [name, MARK + name + MARK]));
  const parts = t(key, params).split(SLOT);
  return parts.map((part, index) => (
    <Fragment key={index}>{index % 2 === 1 ? slots[part] : part}</Fragment>
  ));
}
