import type { ChecksState, ReviewDecision } from "../types";

export function checksState(
  state: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null | undefined,
): ChecksState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return null;
  }
}

export function reviewDecision(
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null,
): ReviewDecision {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changesRequested";
    case "REVIEW_REQUIRED":
      return "reviewRequired";
    case null:
      return null;
  }
}

// Match GitHub's duplicate issue icon.
export function closedReason(
  reason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null,
): "completed" | "notPlanned" | null {
  if (reason === "COMPLETED") return "completed";
  if (reason === "NOT_PLANNED" || reason === "DUPLICATE") return "notPlanned";
  return null;
}
