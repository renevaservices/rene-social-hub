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
