export function nodesOf<T>(
  connection: { nodes?: readonly (T | null)[] | null } | null | undefined,
): T[] {
  return (connection?.nodes ?? []).flatMap((node) => (node ? [node] : []));
}
