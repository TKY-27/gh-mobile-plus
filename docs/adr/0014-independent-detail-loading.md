# 0014. Load independent detail content concurrently

- Status: Accepted
- Date: 2026-11-18

## Context

GitHub can return a valid user profile with a `NOT_FOUND` error for its optional namesake repository. Fetching the rendered README as part of the profile query also delayed identity, pins and profile navigation. Repository READMEs and direct PR tab links waited for other requests before starting independent reads.

## Decision

- Keep the public-repository check in the profile query. Accept an absent namesake repository only at its exact GraphQL field path. Fetch its rendered README in its own query once public visibility is confirmed.
- Request repository README metadata and rendered HTML in parallel for the same ref. Interpret GitHub's HTML media type as text.
- Start Files, Checks and Commits data requests alongside the PR header when entering those tabs.

## Consequences

Profiles without a README still render. A README error can be retried in its section. The repository README keeps its real file path, and a direct PR tab can load its content without waiting for the conversation response.
