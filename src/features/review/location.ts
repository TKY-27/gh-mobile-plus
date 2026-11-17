import type { Translate } from "@/i18n/index.tsx";

function isRange(start: number | null | undefined, end: number): start is number {
  return start !== null && start !== undefined && start !== end;
}

export function lineSpan(start: number | null | undefined, end: number): string {
  return isRange(start, end) ? `${String(start)}–${String(end)}` : String(end);
}

export function lineLocation(t: Translate, start: number | null | undefined, end: number): string {
  return isRange(start, end)
    ? t("review.location.range", { start, end })
    : t("review.location.line", { line: end });
}
