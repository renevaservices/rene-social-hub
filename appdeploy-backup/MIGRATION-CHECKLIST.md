# Rene Social Hub migration checklist

This branch is a backup and migration workspace. The original main branch must not be overwritten.

## Confirmed
- Frontend source and backend source have been copied under appdeploy-backup/.
- AppDeploy source uses @appdeploy/sdk for authentication, database, secrets, and storage; these require replacements for independent hosting.
- AppDeploy deployment reports ready, but scheduled publishing cron is disabled because credits were exhausted. A ready deployment is **not** confirmation that scheduled publishing works.

## Still required before using this as a replacement
- [ ] Run a clean frontend build and resolve errors.
- [ ] Replace AppDeploy-specific backend SDK and authentication with a suitable backend service.
- [ ] Export and securely migrate database records (clients, drafts, scheduled posts, connections) without putting personal data in this public repository.
- [ ] Store API keys and social access tokens in private hosting secrets, never in GitHub source.
- [ ] Configure and test Facebook, Instagram and Threads OAuth callbacks and publishing permissions.
- [ ] Configure a working scheduled job and verify posting to a test account.
- [ ] Verify mobile interaction, client isolation, and error handling.
- [ ] Cut over only after verifying data, connections, and scheduled posts.

**Important:** A GitHub Pages deployment alone cannot run the existing backend or scheduled publishing cron. Do not assume any social account or database has been migrated.
