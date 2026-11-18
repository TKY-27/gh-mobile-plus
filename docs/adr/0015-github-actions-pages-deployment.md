# 0015. Deploy Cloudflare Pages from GitHub Actions

- Status: Accepted
- Date: 2026-11-18

## Context

The production URL and OAuth callback belong to the existing Cloudflare Pages Direct Upload project. Cloudflare requires a new project for native Git integration.

## Decision

On pushes to `main`, GitHub Actions saves the checked build and deploys it with the repository's pinned Wrangler after the check and all browser E2E jobs succeed. The deploy step receives a token with Cloudflare Pages Edit on the hosting account. OAuth and cookie secrets stay in the existing Cloudflare Pages project.

## Consequences

The existing public URL and callback continue to work. Pull requests run CI. Cloudflare Pages retains previous deployments for rollback.
