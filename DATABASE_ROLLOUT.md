# Database Security Rollout

Prepared 2026-10-12. No production schema or account changes were executed.

## Deployment Order

1. In Render's Web service Environment, add `SUPABASE_SERVICE_ROLE_KEY`. Use the current Supabase server-side key without a `VITE_` prefix. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured separately. Do not copy local environment files between repositories.
2. Deploy the verified Web and Worker commits from their independent repositories. Wait for both deployments to finish. The production Web server intentionally refuses to start without the server key.
3. Check the new Web deployment's prices, administration and configuration before applying SQL. Never apply access restrictions while Web still uses the old anonymous-only database client.
4. In the correct Supabase project's SQL Editor, run `supabase_security_hardening.sql`. It creates the missing remote `broadcast_log`, protects 16 application tables and restricts the visit-counter RPC to the server role. It does not delete rows, change prices or rewrite credentials. The private `server_config` table was already created; do not rerun `supabase_worker_state.sql`.
5. Expected verification: `rls_enabled` true, both browser-access flags false, server read/insert flags true for application tables. Report SQL errors; do not disable RLS or reopen anonymous access. A mismatched required table/function aborts the transaction without partial application.
6. Request a read-only API recheck. Private settings, Push keys, contact messages and logs must be inaccessible anonymously. Verify public prices, admin login/settings, contact delivery, Push subscriptions and Worker source settings. Real delivery tests need explicit approval and must use only the owner's device/account.

## Credentials And WhatsApp

- Secrets formerly stored in app_config were readable with the public anon key. Restricting access does not revoke them. Rotate exposed Facebook/Telegram credentials and revoke exposed linked sessions with their providers during a planned maintenance window. Then reconnect Worker using newly authorized sessions. Do not post replacement secrets in chat.
- Preserve a currently connected WhatsApp account while checking cloud persistence. `server_config.key = worker_whatsapp_auth` must contain registered credentials and protocol keys with a recent `updated_at`. Empty `{}` is a logout marker, not a saved session. Verify a successful checkpoint before testing restart. Actual revocation/expiry still requires pairing.
- Rotate the previously shared service-role key using the provider's supported procedure and coordinate both Render services. Legacy JWT rotation may also affect anon keys. Internal Web/Worker shared secrets must match. Do not casually rotate VAPID keys: existing Push subscriptions depend on them.

## Preserved Behavior

- `app_config.config.terms` remains authoritative. The obsolete currency_terms save mirror was removed; legacy fallback reads remain. No duplicate table was created.
- CNY zero observations and the USD mismatch on 2026-10-09 were not fabricated, deleted or rewritten. Validate the source before historical corrections.
- SQLite broadcast timestamps remain milliseconds; remote timestamps use ISO strings matching timestamptz, including cleanup filters.
- Visitor UI, API payloads, Socket.IO, fetching windows and source jobs are unchanged.
- SQL was reviewed but not executed against production or a disposable PostgreSQL instance. Actual policies, constraints and indexes require SQL Editor and post-application verification; local tests are not proof of a deployed rollout.
