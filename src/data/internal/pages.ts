import type { AccountId } from "../session";
import { nextPageUrl, rest, type RestRequest } from "./client";

export async function restPages<Body>(
  accountId: AccountId,
  request: RestRequest,
  maxPages: number = Number.POSITIVE_INFINITY,
): Promise<Body[]> {
  const bodies: Body[] = [];
  let page: RestRequest | null = request;
  while (page && bodies.length < maxPages) {
    const response = await rest<Body>(accountId, page);
    bodies.push(response.body);
    const next = nextPageUrl(response.headers);
    // The next URL already carries the query.
    page = next === null ? null : { ...request, path: next, query: undefined };
  }
  return bodies;
}
