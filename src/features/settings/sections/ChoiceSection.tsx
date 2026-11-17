import { SegmentedControl, type Segment } from "@/ui/SegmentedControl.tsx";
import styles from "../Settings.module.css";

export function ChoiceSection<T extends string>(props: {
  title: string;
  footer: string;
  segments: readonly Segment<T>[];
  selected: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.choice}>
      <h2 className={styles.choiceTitle}>{props.title}</h2>
      <SegmentedControl
        label={props.title}
        segments={props.segments}
        selected={props.selected}
        onChange={props.onChange}
      />
      <p className={styles.choiceFooter}>{props.footer}</p>
    </div>
  );
}
