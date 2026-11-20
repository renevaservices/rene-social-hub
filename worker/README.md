# Cloudflare Worker

This directory contains the current `rene-social-hub-api-test` Worker source. The GitHub Pages frontend remains in the repository root.

The existing Facebook cron handler and encrypted connection flows are preserved. Instagram automatic publishing is still disabled. The additional owner-only `/admin/instagram` page provides a read-only Meta permission check and JPEG image preparation.

## Owner flow

Open `/admin`, sign in with the existing password, and follow **Check Instagram readiness and prepare images**. Use **Check Instagram readiness** to verify token validity, app identity, required scopes and the expected Instagram account. Tokens, app credentials and upstream error messages are never returned in the report. This check does not reconnect accounts or send a post.

JPEG images up to 8 MB can be prepared under `/admin/instagram`. Images are held in D1 in 256 KB chunks, accessible through a random 256-bit unlisted capability URL under `/instagram-media/`. The link expires in 30 days, with expired storage removed on later uploads. Image URLs are intended for artwork that will be made public; the owner page explains this before upload. Image preparation does not publish content. Image format/size rules for actual publishing must still be checked before a reviewed publishing test.

Run `npm install` and `npm test` to verify the readiness checks, owner authorization, CSRF protection, image storage and expiry. Apply `migrations/0001_instagram_media.sql` to the existing Social Hub database before deploying the three Worker modules. Keep existing bindings and the five-minute cron schedule. Do not commit secret values.

Deployment bindings: DB, AI, existing secret bindings and AUTO_WEEKLY_FACEBOOK_ENABLED. No Meta app settings or authorization grants are changed by this update.
