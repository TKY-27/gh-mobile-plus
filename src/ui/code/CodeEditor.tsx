import { lazy, Suspense } from "react";
import styles from "./editor.module.css";

export interface CodeEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  language: string | null;
  label: string;
  softWrap: boolean;
  keyboardOpen: boolean;
}

const Editor = lazy(() => import("./editor.tsx"));

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<pre className={styles.fallback}>{props.initialValue}</pre>}>
      <Editor {...props} />
    </Suspense>
  );
}
