import { useMemo } from "react";
import { useLanguage } from "@/i18n/index.tsx";

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * KILOBYTE;

export function useFormatSize(): (bytes: number) => string {
  const language = useLanguage();
  return useMemo(() => {
    const format = (unit: "byte" | "kilobyte" | "megabyte") =>
      new Intl.NumberFormat(language, {
        style: "unit",
        unit,
        unitDisplay: "narrow",
        maximumFractionDigits: 1,
      });
    const bytes = format("byte");
    const kilobytes = format("kilobyte");
    const megabytes = format("megabyte");
    return (size) => {
      if (size < KILOBYTE) return bytes.format(size);
      if (size < MEGABYTE) return kilobytes.format(size / KILOBYTE);
      return megabytes.format(size / MEGABYTE);
    };
  }, [language]);
}
