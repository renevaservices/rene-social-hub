# Cloudflare Worker

This directory contains the current `rene-social-hub-api-test` Worker source. The GitHub Pages frontend remains in the repository root.

The existing Facebook cron handler and encrypted connection flows are preserved. Instagram publishes only posts explicitly approved in the owner planner. The additional owner-only `/admin/instagram` page provides a read-only Meta permission check and JPEG image preparation.

## Owner flow

Open `/admin`, sign in with the existing password, and follow **Check Instagram readiness and prepare images**. Use **Check Instagram readiness** to verify token validity, app identity, required scopes and the expected Instagram account. Tokens, app credentials and upstream error messages are never returned in the report. This check does not reconnect accounts or send a post.

JPEG images up to 8 MB can be prepared under `/admin/instagram`. Images are held in D1 in 256 KB chunks, accessible through a random 256-bit unlisted capability URL under `/instagram-media/`. The link expires in 30 days, with expired storage removed on later uploads. Image URLs are intended for artwork that will be made public; the owner page explains this before upload. Image preparation does not publish content. Image format/size rules for actual publishing must still be checked before publication.

Run `npm install` and `npm test` to verify the readiness checks, owner authorization, CSRF protection, image storage and expiry. Apply `migrations/0001_instagram_media.sql` to the existing Social Hub database before deploying all Worker modules. Keep existing bindings and the five-minute cron schedule. Do not commit secret values.

Deployment bindings: DB, AI, existing secret bindings and AUTO_WEEKLY_FACEBOOK_ENABLED. No Meta app settings or authorization grants are changed by this update.

The image form now converts PNG, WebP and JPEG source images in the browser to JPEG (maximum source size 20 MB, scaled to at most 1440 pixels per edge). Server validation checks JPEG bytes instead of trusting a phone-supplied MIME label. The image preparation script is an authenticated same-origin resource. Native JPEG multipart uploads still work without JavaScript.


## Instagram scheduling

Apply `migrations/0002_instagram_test_posts.sql` and `migrations/0003_instagram_schedule.sql` alongside the existing image migration. Deploy all Worker modules. `/admin/instagram/planner` uses the existing owner session and same-origin checks. A saved draft has no publishing authority: its separate review form must be submitted to schedule the exact account, image, caption and time. All displayed/entered times are SAST (UTC+2), converted to UTC milliseconds on the server. Cancelling drafts, queued posts and waiting image containers is atomic; a post already being sent cannot be recalled.

The existing five-minute cron independently processes up to three due Instagram jobs, while the existing Facebook task remains unchanged. There is no automatic content generation or automatic enrolment of existing Facebook drafts/test posts. Each Instagram schedule is explicitly approved. Jobs are claimed atomically; Meta containers are created only near the due time, with status checked before publication. Pending containers are polled on the next cron run. A request with an uncertain result is marked for review, never blindly republished. Interrupted claims older than ten minutes are marked for review. Posts more than thirty minutes overdue fail instead of publishing stale content. Images must remain available at least one hour after the requested time, and scheduled images must have a feed-compatible aspect ratio. The saved account ID and current authorization are checked at delivery. Failed posts are visible in the owner planner with sanitized explanations.

Validation: `npm test` covers explicit time-zone conversion, draft/approval boundaries, authorization/CSRF, cancellation, concurrent claims, processing containers, uncertain publish results, account changes, expired images and missed times. These scheduling tests use a local D1 database and mocked Meta responses. Production confirmation requires an owner-approved future post.

## Threads connection and scheduling

Apply `migrations/0004_threads.sql` and deploy every Worker module, including `threads.js`. Preserve the Facebook/Instagram bindings and cron. The Threads application ID is the public ID from the owner's Meta Threads settings (`1710838133324746`), separate from the Facebook app ID. Add the corresponding Threads app secret directly in the Cloudflare Worker as the `THREADS_APP_SECRET` Secret binding. Never place its value in GitHub, logs, chat, or client HTML. Optional `THREADS_APP_ID` overrides the public default.

Register the exact Meta redirect callback URL:
`https://rene-social-hub-api-test.renevaservices.workers.dev/api/oauth/callback/threads`
Keep existing callback URLs while completing migration. OAuth starts only from an authenticated, same-origin POST under `/admin/threads`. State is random, expires after ten minutes and is consumed once. The callback exchanges the code, requires a long-lived token, checks the returned profile and `threads_basic` / `threads_content_publish` scopes, and stages only AES-GCM encrypted credentials for fifteen minutes. An authenticated, same-origin owner confirmation is required before the account is saved. Connection alone never schedules or publishes anything.

The owner Threads page displays prepared text drafts from `scheduled_posts`. A separate explicit scheduling POST validates future times, token expiry, account identity and the 500-character limit. It atomically copies the approved account, caption and UTC time to `threads_publish_jobs`, which is the only source the Threads cron publishes. The five-minute cron creates a TEXT container, checks its status, and publishes only FINISHED containers. Atomic claims prevent duplicates; processing containers are checked on a later run without creating another container. Ambiguous publication and interrupted jobs require manual review. Posts over thirty minutes late fail rather than posting stale content. The planner supports cancellation before a job is claimed. Credentials are not automatically refreshed; reconnect before the displayed expiration date.

Threads tests use local D1 and mocked Meta responses, covering state replay, explicit account confirmation, authorization/CSRF, draft approval, account mismatch, processing, cancellation and uncertain results. Live connection and a scheduled post must still be verified by the owner after configuring the Meta callback and Cloudflare secret.


### Owner login navigation

Apply `migrations/0005_login_events.sql`. Successful password submission now returns a 200 Signed in document with the Secure, HttpOnly, SameSite=Strict cookie, followed by an explicit Continue link. This avoids immediately navigating through a cookie-setting redirect chain. The session check still enforces the signed cookie and the allowlist of internal destinations. Login diagnostic rows contain only a stage name, time and cookie-presence boolean, are pruned after thirty minutes on authentication activity, and are capped at one hundred rows. They never contain passwords, tokens, cookie values, account IDs, IPs or request URLs. Diagnostic errors never block authentication. Automated tests cover the first-party document, signed-cookie validation, missing-cookie notice and redirect allowlist; actual Safari behavior still needs owner confirmation.

## Client automation

Apply `migrations/0006_client_automation.sql` followed by `migrations/0007_client_media_expiry.sql`, then deploy all modules, including `client-api.js`, `client-oauth.js`, `client-ui.js` and `client-publisher.js`. The owner-only `/admin/clients` workspace is linked from Admin and the GitHub Pages Clients & Businesses screen. Existing browser-only planning records remain local; they are not silently uploaded or imported. The existing owner session and same-origin validation protect every client mutation. This is an owner-operated client-management feature; clients do not receive owner-dashboard access.

Add these callbacks alongside existing Meta callbacks before using client authorization:
- Facebook: `https://rene-social-hub-api-test.renevaservices.workers.dev/api/oauth/callback/client-facebook`
- Instagram with Facebook Login: `https://rene-social-hub-api-test.renevaservices.workers.dev/api/oauth/callback/client-instagram`
- Threads: `https://rene-social-hub-api-test.renevaservices.workers.dev/api/oauth/callback/client-threads`

App Review, Advanced Access and any applicable Meta business/Tech Provider verification remain external prerequisites for accounts outside allowed app roles. The code does not bypass these requirements or claim public-client approval. Facebook / Instagram reuse the existing app credentials and login configuration; Threads uses its separate credentials. No secrets are sent to client HTML or stored unencrypted. The owner generates a ten-minute authorization link bound to a client and platform. A client can authorize through their own Meta session without receiving the Hub password. The callback consumes state once, exchanges long-lived authorization, verifies account identity and publishing scopes, stages encrypted account candidates for fifteen minutes, and returns a first-party Continue page. The owner must choose the exact returned account for that client. Own-business accounts are excluded, and one platform/account combination cannot be assigned to two client workspaces.

Rows are scoped by client ID throughout account confirmation, media association, drafting, review, approval, cancellation and asynchronous delivery. Image capabilities are created only by authenticated upload and associated with the uploading client; choosing another client's image or connection fails. Approved jobs retain client ID, connection ID/version, platform, account ID, account display name, caption, image and UTC time. Selection is revalidated during approval and again during cron delivery. Reconnecting or disconnecting invalidates old connection versions. Disconnect cancels queued jobs; a write already in flight cannot be recalled. Account checks never fall back to Rene's personal connection tables.

The existing five-minute cron adds an independent client task, processing up to three due destinations per run. Facebook supports text or a prepared JPEG photo; Instagram requires a compatible prepared JPEG; Threads supports text or a prepared image. Multi-platform captions are limited to 2,200 characters, or 500 when Threads is selected. An owner review checkbox records confirmation of client approval before scheduling. Atomic claims, container persistence and no retry after uncertain publication protect against duplicate posts. Failed or interrupted writes are visible in the client queue for review. Jobs more than thirty minutes overdue fail instead of publishing stale content. Client images must remain valid an hour beyond the scheduled time. Tokens are checked against platform permissions/account identity at delivery; reconnect before recorded expiration.

Boundary tests use synthetic clients and local D1 with mocked Meta: wrong-client account selection, image selection, review/cancel/disconnect requests, OAuth state binding/replay, own-account exclusion, all three account authorization flows, long-lived token exchange, review approval, concurrent claims, account version changes, image expiry, cancellation, processing containers and ambiguous writes. These validate software behavior, not approval of real external-client access. A real authorized client connection and approved scheduled post remain the live acceptance check.
