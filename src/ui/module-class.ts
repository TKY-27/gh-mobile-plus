/** Vite types module classes as optional. */
export function moduleClass(name: string | undefined): string {
  if (name === undefined) throw new Error("Unknown CSS module class");
  return name;
}
