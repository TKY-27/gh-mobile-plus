import { Search, X } from "lucide-react";
import { Input } from "react-aria-components/Input";
import {
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
} from "react-aria-components/SearchField";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "./Button.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./fields.module.css";

export interface SearchFieldProps extends Omit<
  AriaSearchFieldProps,
  "className" | "style" | "children"
> {
  label: string;
  placeholder?: string;
}

export function SearchField({ label, placeholder, ...props }: SearchFieldProps) {
  const t = useT();
  return (
    <AriaSearchField {...props} aria-label={label} className={moduleClass(styles.search)}>
      <Search aria-hidden />
      <Input placeholder={placeholder ?? ""} enterKeyHint="search" />
      <span className={styles.clear}>
        <IconButton label={t("common.clear")}>
          <X aria-hidden />
        </IconButton>
      </span>
    </AriaSearchField>
  );
}
