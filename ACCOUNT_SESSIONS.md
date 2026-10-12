# Account session recovery

## Ownership

- Personal Telegram and WhatsApp connections run only in Worker. Web keeps its Bot API contact messages, critical alerts and image delivery; it cannot open a personal MTProto connection or issue account login codes.
- Worker stores Telegram credentials in private `server_config.worker_telegram_auth`. A new login does not copy its auth key into shared `app_config`. Existing environment/shared credentials are legacy fallback only when private storage was successfully checked and no checkpoint exists.
- WhatsApp stores its complete credentials/protocol-key bundle in `server_config.worker_whatsapp_auth`. QR pairing is valid with `me` and `account`, even when Baileys leaves `registered` false. Empty `{}` remains an explicit logout tombstone.
- `worker_account_lease` uses atomic compare-and-swap on the existing table to coordinate overlapping Worker instances. It renews every 30 seconds and expires after 120 seconds. Database uncertainty closes account sockets without logging out. The next owner restores private credentials before reconnecting. This is an account-connection lease, not an exactly-once publishing/scheduler guarantee.
- Shutdown stops new account connections, closes SDK clients, checkpoints WhatsApp while still owning the lease, then releases it. A standby instance cannot upload stale WhatsApp keys. All shutdown steps have a final 25-second process deadline.

## Deployment and owner steps

1. Deploy Web first and wait for deployment completion. In Web's Render environment remove `TG_SESSION_V2`, `TELEGRAM_SESSION` and `VITE_TELEGRAM_SESSION` if present. Do not remove bot tokens or configured admin chat IDs. The code also blocks legacy personal-account fallback.
2. Deploy Worker and wait for its old process to stop before pairing accounts on this first rollout. Older deployments do not participate in the new lease.
3. Telegram already returned `AUTH_KEY_DUPLICATED`: Telegram invalidated that auth key. Use Worker's account dashboard to request a fresh login code and complete 2FA if required. Do not reuse or copy the new session into Web/another service. Worker only reports durable login success after the private save succeeds. Failed persistence can retry without repeating an already successful OTP authorization.
4. The observed WhatsApp checkpoint was empty. Pair once from Worker using QR. Wait for connected status and a successful cloud checkpoint with no persistence error before restarting. If the provider reports logged-out credentials, use explicit disconnect to clear that revoked session before pairing again; ordinary network failures do not require logout.
5. Restart Worker once after both accounts are saved. Confirm Telegram connected and WhatsApp connected without QR. On rolling restarts, a short standby period is expected; after an abrupt crash, lease expiry can take up to two minutes. Web continues displaying saved prices independently.
6. Check contact-bot delivery and critical alerts separately. Weekly harvest images from Web now use the bot: grant the bot posting access to the target channel, or configure the administration chat ID for private delivery.

No new table, RPC or schema migration is needed. `server_config` must remain service-role-only and allow server select/insert/update/delete. Never expose its session values, or put the service-role key in a `VITE_*` variable.

## Automatic WhatsApp sources

The owner confirms all channels and groups in this account are currency-price sources. Incoming channel/group messages therefore use the existing extraction pipeline automatically, without saved per-source selection. Old disabled group/channel entries no longer block extraction; use the existing global WhatsApp extraction stop to pause it. Private chats still require explicit opt-in. The dashboard marks automatic sources as checked/read-only; discovery does not overwrite shared settings, join new groups, follow new channels, poll for prices, or process the whole history. Valid source timestamps and the saved extraction rules still govern every quote.

## Verification limits

`npm test` includes account/session fixtures covering private precedence, restart, persistence failures, concurrent saves, SDK single-flight/credential replacement, revoked sessions, OTP client disposal, atomic lease acquisition/handoff/expiry and stopped admission. Existing WhatsApp tests also cover real QR-shaped credentials, key checkpoints, standby write suppression, backoff, logout tombstones and ephemeral restart. These tests never contact accounts or write production data.

A real Render restart after re-pairing is still required. Transport timeouts do not by themselves mean a session was erased; SDK reconnection and the one-minute memory-only monitor retain credentials. Logged-out/revoked keys require owner action rather than infinite retries.
