# Dollar Price - Worker repository instructions

## Scope and local pairing

This is the independent Worker repository, not the public Web application. The owner describes Worker as responsible for external price ingestion, validation, Supabase persistence, scheduling, publishing, Web update notifications, and a private administration dashboard. These responsibilities must be checked against the implementation before claiming they all work.

The paired checkouts on this machine are:

- Worker: `C:/Users/LEVEL UP/Projects/Dollar-Price/worker_server-main` -> `https://github.com/Moatezsager/worker_server.git`.
- Web: `C:/Users/LEVEL UP/.codex/worktrees/e2fc/Dollar-main` -> `https://github.com/Moatezsager/Dollar.git`.

Read Web's `AGENTS.md` when investigating cross-service contracts. Re-check paths and remotes on another machine or after moving a checkout. Use the relevant project's working directory, and fetch, stage, commit, and push each repository separately. Never nest or mix the repositories.

## Confirmed setup

- The cloned default branch is `main`; `package.json` names this project `lyd-index-worker`.
- Development starts `src/worker.ts`; production starts `dist/worker.cjs`.
- Available scripts include `lint`, `test`, and `build`. Tests use isolated source-module fixtures, not a production Worker import.
- `postinstall` runs the build. Inspect scripts and test imports before installation or execution.
- The repository ignores environment files except `.env.example`, database files, and `whatsapp_auth/`. Do not treat an example file as proof of deployed configuration.

## Required working rules

- Preserve the independent private dashboard, its authentication, all source integrations, and scheduled jobs. Do not move Worker responsibilities to Web or duplicate them there.
- The projects share Supabase. No schema changes or destructive migrations without explicit approval and an impact analysis for both projects.
- Trace source -> validation -> successful database save -> Web notification -> Socket.IO -> React before changing update behavior. Do not mark failed persistence as successful or manufacture price freshness.
- Confirm HTTP paths, methods, authentication headers, payloads, database fields, and timestamps on both sides before changing contracts. Web's notification endpoint is `POST /api/internal/notify-rates-updated`; verify the Worker caller instead of assuming it matches.
- The owner confirms visitor Web Push is sent by Web only. Do not add a competing visitor notification pipeline here.
- Start with read-only inspection and isolated tests. Do not run production scraping, publishing, Telegram/WhatsApp delivery, database writes, or live jobs just to review code.
- Keep secrets in ignored local environment files or deployment settings. Never print secrets, commit sessions, copy Web credentials into Worker, or expose privileged values to dashboard/browser code.
- Keep Render resource usage low; avoid duplicate schedulers, intensive polling, and unbounded retries.
- Distinguish owner-provided architecture, code-confirmed behavior, and actual runtime evidence. A clone or passing build is not proof that either deployed service is healthy.

## Verified Local Implementation (2026-10-11)

- Parallel source and manual updates use `commitParallelRates`: serialize writes, validate values/source times, reject older snapshots, save authoritative tables before committing RAM, then queue publishing. CBL validates today's bulletin even for forced requests, saves before committing, shares one in-flight fetch, and catches up at most hourly after 11:00.
- Cold Worker/Web states contain no sample prices or synthetic history. Missing sources must stay unavailable, not become a made-up quote.
- Source handlers own persistence. Schedulers and API wrappers must not save the same prices or notify Web again.
- Worker -> Web uses `POST /api/internal/notify-rates-updated` with `x-worker-secret`, a 5-second timeout, and at most three attempts per notification batch. Web 200 means accepted, not completed database synchronization.
- Web -> Worker retains `POST /internal/jobs/{refresh,cbl}` and `/api/whatsapp/{status,qr,init,disconnect,toggle-auto}`. The new toggle requires a boolean `enabled` and the same configured secret. Do not assume `WORKER_URL` and `WORKER_SERVER_URL` are interchangeable in Web.
- One price publishing queue tracks deliveries, attempts and retry times per Telegram/Facebook platform. Successful targets are not resent when the other fails. Newer values queued during an in-flight send must survive. Failed items remain after the bounded retry budget for manual review.
- Queue state uses local SQLite and existing Supabase `server_config` key `worker_broadcast_queue`. Graceful shutdown attempts a bounded cloud flush. Remote checkpoints are not an exactly-once external-delivery guarantee.
- WhatsApp sessions use existing `server_config` key `worker_whatsapp_auth`, not repeated whole-`app_config` writes. Hash the full bundle, preserve protocol keys/newer local credentials, validate filenames, and respect logout tombstones. Cloud RLS/privacy must be verified before treating this table as private.
- Restore sessions through the WhatsApp service before automatic startup connection. Do not copy private checkpoint keys into shared `appConfig`. Legacy credentials already stored in `app_config` require a separately verified migration; they have not been remotely removed by local changes.
- Explicit logout must report failed cloud/local cleanup, not success. Keep the local logout tombstone to prevent restoring an older checkpoint after restart. Failed remote deletion still requires administrator retry before an ephemeral redeploy.
- WhatsApp discovers chats but extracts prices only from explicitly enabled configured sources. Its public/admin toggle shares the scraper flag; do not add another independent boolean.
- Visitor Web Push belongs exclusively to Web. Worker contains no Push sender or VAPID dependency.
- Shared administration settings still use whole-row `app_config` writes. Avoid simultaneous settings edits from both dashboards until database-side atomic patching is verified. No schema migration was performed.

## Isolated Verification

- `npm test`: actual persistence, source processing, CBL parsing/job, per-platform queue/failures/restoration, WhatsApp bundle safety, cold state, scheduler lock and authenticated HTTP routes. No production accounts, environment loading, external sends or real database writes.
- Set `WEB_PROJECT_PATH` to the separate Web checkout to also verify Web snapshot metadata/cache and rejection of older rows.
- The current suite contains 21 regression scenarios and six integration groups when the paired Web path is supplied. It also checks Web notification authentication, immediate acknowledgement, bounded database retries and coalesced synchronization.
- `node tests/dashboard-ui.cjs`: isolated browser dashboard checks at 390/768/1440 pixels, untrusted text/JSON escaping, quoted edit controls and failed-platform status. Set `PLAYWRIGHT_MODULE` and `UI_BROWSER_CHANNEL` when required. Optional `UI_ARTIFACT_DIR` stores screenshots outside the repo.
- `npm run lint` and `npm run build` do not establish deployed health. Node 20.18.0 is still the declared Render runtime; the local verification runtime was Node 24.14.0.
- `npm ci` runs the existing build once through `postinstall`; do not append a duplicate build to Render's Worker command. Both npm audits reported zero known advisories on 2026-10-11, which is not a complete security assessment. npm lockfiles are the verified installation path; do not switch to an old Bun lockfile without verification.
