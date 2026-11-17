import { useState } from "react";

export interface SheetSession<T> {
  value: T;
  open: boolean;
  // Reset input by keying each opening.
  session: number;
}

/** Stays mounted for the exit animation. */
export function useSheetSession<T>() {
  const [sheet, setSheet] = useState<SheetSession<T> | null>(null);
  return {
    sheet,
    open: (value: T) => {
      setSheet((current) => ({ value, open: true, session: (current?.session ?? 0) + 1 }));
    },
    setOpen: (open: boolean) => {
      setSheet((current) => current && { ...current, open });
    },
  };
}
