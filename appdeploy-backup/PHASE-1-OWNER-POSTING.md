# Phase 1 — Rene VA Services only

**Goal:** Make scheduled posting work for the owner's Facebook, Instagram and Threads accounts without depending on AppDeploy. Client workspaces and invitations are deferred.

## What the current frontend calls
- GET /api/oauth/status and GET /api/oauth/start/:provider — connection status and OAuth setup
- GET/POST /api/scheduled-posts and DELETE /api/scheduled-posts/:id — scheduling
- POST /api/facebook/publish, /api/instagram/publish, /api/threads/publish — publishing
- POST /api/media/upload — media upload
- Other endpoints (client workspace, AI image/content generation) are out of scope for phase 1.

## Proposed architecture to evaluate
- React/Vite dashboard on static hosting (GitHub Pages or Cloudflare Pages)
- A separately hosted API for login, OAuth callbacks, scheduling, and publishing (Cloudflare Workers is a candidate; assess free-plan limits and compatibility before selecting)
- A private database for scheduled posts and connection metadata; encrypt or securely store long-lived social tokens outside the public GitHub repository
- A server-side scheduler with retries, logging, deduplication and per-platform results

## Non-negotiable checks
1. Preserve the existing GitHub main branch and original AppDeploy data.
2. Do not copy social access tokens or personal client data into this public repository.
3. Determine whether AppDeploy data can be exported before replacing or deactivating it.
4. Verify Meta app settings, scopes and callback URLs before reconnecting accounts.
5. Test publishing privately on owner's accounts before enabling live scheduling.
6. Ensure every scheduled post has an idempotency key and records success/failure to avoid duplicate posts.

## Known blockers
- The frontend imports `@appdeploy/client`; the independent API/auth client has not been implemented.
- The backend imports `@appdeploy/sdk`; its database, auth, secrets, storage and cron functions require replacement.
- AppDeploy's scheduler is disabled due to exhausted credits; GitHub Pages cannot run it.

This is a plan, not a claim that migration, hosting or posting has been completed.
