const FORBIDDEN = /[\s\p{Cc}~^:?*[\\]|\.\.|@\{|\/\/|^[/.-]|[/.]$|\.lock$|\.lock\/|\/\./u;

export function isValidBranchName(name: string): boolean {
  return name !== "" && name !== "@" && !FORBIDDEN.test(name);
}
