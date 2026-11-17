import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { Key, Selection } from "react-aria-components/ListBox";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SearchField } from "@/ui/SearchField.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import styles from "./Conversation.module.css";

const SEARCH_THRESHOLD = 8;

export interface PickerOption {
  id: string;
  label: string;
  description?: string | null;
  leading?: ReactNode;
}

interface PickerProps {
  title: string;
  options: readonly PickerOption[] | undefined;
  isPending?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage: string;
  disabledKeys?: readonly string[];
  note?: string;
}

function selectionKeys(selection: Selection, options: readonly PickerOption[]): string[] {
  if (selection === "all") return options.map((option) => option.id);
  return [...selection].map((key: Key) => String(key));
}

function PickerList(
  props: PickerProps & {
    selectionMode: "single" | "multiple";
    selected: readonly string[];
    onSelectionChange: (selected: string[]) => void;
  },
) {
  const t = useT();
  const [query, setQuery] = useState("");
  if (props.isPending ?? false) {
    return (
      <div className={styles.pickerStatus}>
        <Spinner />
      </div>
    );
  }
  if (!props.options) {
    return (
      <ErrorState error={props.error} {...(props.onRetry ? { onRetry: props.onRetry } : {})} />
    );
  }
  const needle = query.trim().toLowerCase();
  const options = props.options;
  const visible = options.filter((option) => option.label.toLowerCase().includes(needle));
  return (
    <div className={styles.picker}>
      {props.note ? <p className={styles.pickerNote}>{props.note}</p> : null}
      {options.length > SEARCH_THRESHOLD ? (
        <div className={styles.pickerSearch}>
          <SearchField label={t("issue.picker.filter")} value={query} onChange={setQuery} />
        </div>
      ) : null}
      <ListBox
        aria-label={props.title}
        items={visible}
        selectionMode={props.selectionMode}
        selectedKeys={props.selected}
        disabledKeys={props.disabledKeys ?? []}
        onSelectionChange={(selection) => {
          props.onSelectionChange(selectionKeys(selection, options));
        }}
        className={moduleClass(styles.pickerList)}
        renderEmptyState={() => <p className={styles.pickerStatus}>{props.emptyMessage}</p>}
      >
        {(option) => (
          <ListBoxItem
            id={option.id}
            textValue={option.label}
            className={moduleClass(styles.pickerOption)}
          >
            {option.leading}
            <span className={styles.pickerText}>
              <span className={styles.pickerLabel}>{option.label}</span>
              {option.description ? (
                <span className={styles.pickerDescription}>{option.description}</span>
              ) : null}
            </span>
            <Check className={styles.pickerCheck} aria-hidden />
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
}

/** Remount to discard unsaved selections. */
export function MultiPickerSheet(
  props: PickerProps & {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    initial: readonly string[];
    onApply: (selected: readonly string[]) => void;
  },
) {
  const t = useT();
  const [selected, setSelected] = useState<readonly string[]>(props.initial);
  const close = () => {
    props.onOpenChange(false);
    const changed =
      selected.length !== props.initial.length ||
      selected.some((id) => !props.initial.includes(id));
    if (changed) props.onApply(selected);
  };
  return (
    <Sheet
      isOpen={props.isOpen}
      onOpenChange={(isOpen) => {
        if (isOpen) props.onOpenChange(true);
        else close();
      }}
      title={props.title}
    >
      <PickerList
        {...props}
        selectionMode="multiple"
        selected={selected}
        onSelectionChange={setSelected}
      />
      <div className={styles.pickerDone}>
        <Button variant="primary" wide onPress={close}>
          {t("issue.picker.done")}
        </Button>
      </div>
    </Sheet>
  );
}

export function SinglePickerSheet(
  props: PickerProps & {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    selected: string | null;
    onSelect: (id: string) => void;
  },
) {
  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={props.title}>
      <PickerList
        {...props}
        selectionMode="single"
        selected={props.selected === null ? [] : [props.selected]}
        onSelectionChange={([id]) => {
          props.onOpenChange(false);
          if (id !== undefined && id !== props.selected) props.onSelect(id);
        }}
      />
    </Sheet>
  );
}
