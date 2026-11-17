interface EditLine {
  kind: "add" | "del" | "context";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

function lcsRow(before: readonly string[], after: readonly string[]): Uint32Array {
  const lengths = new Uint32Array(after.length + 1);
  for (const oldText of before) {
    let diagonal = 0;
    after.forEach((newText, index) => {
      const previous = lengths[index + 1] ?? 0;
      lengths[index + 1] =
        oldText === newText ? diagonal + 1 : Math.max(previous, lengths[index] ?? 0);
      diagonal = previous;
    });
  }
  return lengths;
}

function compareLines(
  before: readonly string[],
  after: readonly string[],
  emit: (kind: EditLine["kind"], text: string) => void,
): void {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    emit("context", before[prefix] ?? "");
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  const oldLines = before.slice(prefix, before.length - suffix);
  const newLines = after.slice(prefix, after.length - suffix);
  if (oldLines.length === 0 || newLines.length === 0) {
    oldLines.forEach((text) => {
      emit("del", text);
    });
    newLines.forEach((text) => {
      emit("add", text);
    });
  } else if (oldLines.length === 1) {
    const text = oldLines[0] ?? "";
    const match = newLines.indexOf(text);
    if (match < 0) emit("del", text);
    newLines.forEach((newText, index) => {
      emit(index === match ? "context" : "add", newText);
    });
  } else {
    const middle = Math.floor(oldLines.length / 2);
    const left = lcsRow(oldLines.slice(0, middle), newLines);
    const right = lcsRow(oldLines.slice(middle).reverse(), [...newLines].reverse());
    let split = 0;
    let longest = -1;
    for (let index = 0; index <= newLines.length; index++) {
      const length = (left[index] ?? 0) + (right[newLines.length - index] ?? 0);
      if (length > longest) {
        longest = length;
        split = index;
      }
    }
    compareLines(oldLines.slice(0, middle), newLines.slice(0, split), emit);
    compareLines(oldLines.slice(middle), newLines.slice(split), emit);
  }
  before.slice(before.length - suffix).forEach((text) => {
    emit("context", text);
  });
}

export function diffLines(before: string, after: string): readonly EditLine[] {
  const lines: EditLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  compareLines(
    before === "" ? [] : before.split("\n"),
    after === "" ? [] : after.split("\n"),
    (kind, text) => {
      lines.push({
        kind,
        text,
        oldLine: kind === "add" ? null : oldLine++,
        newLine: kind === "del" ? null : newLine++,
      });
    },
  );
  return lines;
}
