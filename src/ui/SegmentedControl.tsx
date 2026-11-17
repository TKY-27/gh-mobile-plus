import type { Key } from "react-aria-components/Collection";
import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";
import { moduleClass } from "./module-class.ts";
import styles from "./SegmentedControl.module.css";

export interface Segment<T extends string> {
  id: T;
  label: string;
  count?: string;
}

export function SegmentedControl<T extends string>(props: {
  label: string;
  segments: readonly Segment<T>[];
  selected: T;
  onChange: (id: T) => void;
  columns?: number;
}) {
  const { columns } = props;
  return (
    <ToggleButtonGroup
      aria-label={props.label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[props.selected]}
      onSelectionChange={(keys: Set<Key>) => {
        const next = props.segments.find((segment) => keys.has(segment.id));
        if (next) props.onChange(next.id);
      }}
      className={moduleClass(styles.group)}
      data-columns={columns}
      {...(columns === undefined
        ? {}
        : { style: { gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` } })}
    >
      {props.segments.map((segment) => (
        <ToggleButton key={segment.id} id={segment.id} className={moduleClass(styles.segment)}>
          <span>{segment.label}</span>
          {segment.count === undefined ? null : (
            <span className={styles.count}>{segment.count}</span>
          )}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
