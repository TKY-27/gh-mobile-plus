export function property(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringProperty(value: unknown, name: string): string | null {
  const found = property(value, name);
  return typeof found === "string" ? found : null;
}

export async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body === "") return null;
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
