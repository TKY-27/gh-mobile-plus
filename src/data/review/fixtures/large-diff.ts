export const LARGE_DIFF_LINES = 5000;
const CHANGE_EVERY = 3;

export function largeDiffPatch(lineCount: number = LARGE_DIFF_LINES): string {
  const body: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  while (body.length < lineCount) {
    const index = body.length;
    if (index % CHANGE_EVERY === 0 && body.length + 1 < lineCount) {
      body.push(`-  const value${String(index)} = legacy(${String(index)});`);
      body.push(`+  const value${String(index)} = modern(${String(index)});`);
      oldCount++;
      newCount++;
    } else {
      body.push(`   total += ${String(index)};`);
      oldCount++;
      newCount++;
    }
  }
  return [`@@ -1,${String(oldCount)} +1,${String(newCount)} @@ function generated()`, ...body].join(
    "\n",
  );
}
