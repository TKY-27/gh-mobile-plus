export interface Actor {
  login: string;
  avatarUrl: string;
}
export interface RepoRef {
  owner: string;
  name: string;
}
export type ChecksState = "success" | "failure" | "pending" | null;
export type ReviewDecision = "approved" | "changesRequested" | "reviewRequired" | null;
export interface Label {
  name: string;
  color: string;
  description: string | null;
}
export interface ReactionGroup {
  content: ReactionContent;
  count: number;
  viewerHasReacted: boolean;
}
export type ReactionContent =
  "THUMBS_UP" | "THUMBS_DOWN" | "LAUGH" | "HOORAY" | "CONFUSED" | "HEART" | "ROCKET" | "EYES";
export interface RepoSummary {
  owner: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  stars: number;
  language: { name: string; color: string | null } | null;
  updatedAt: string;
}
export interface Release {
  repo: RepoRef;
  tagName: string;
  name: string;
  publishedAt: string;
  isPrerelease: boolean;
  author: Actor | null;
}
export interface Page<T> {
  items: readonly T[];
  nextCursor: string | null;
}
