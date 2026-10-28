# Daily history and weekly report rollout

1. Run `supabase_rate_history_daily.sql` once in the shared Supabase SQL Editor. The final result must show `rls_enabled=true`, `anon_can_read=false`, `authenticated_can_read=false`, and `server_has_access=true`.
2. Deploy Web first. The authenticated `/api/internal/weekly-harvest` endpoint supplies the canonical image and caption; the public report page supplies a separate landscape Open Graph image. Web cleanup buttons now dispatch Worker's existing authenticated maintenance job.
3. Deploy Worker. Its shared secret must match Web. The weekly job prepares the previous Saturday-Friday report at Saturday 00:05 Africa/Tripoli. Telegram retains its existing delivery policy. Facebook's weekly image replaces one of its scheduled 14:00/18:00/22:00 market bulletins (editable in the dashboard); only official CBL bulletins remain a separate Sunday-Thursday morning exception. Facebook links appear in the first comment, not the post body. Review uncertain delivery on the Page before any manual resend.
4. Trigger maintenance once from the Worker dashboard or the existing Web cleanup button. Check Worker logs for the actual completion and `summarized_days`; an accepted Web request is not completion. Missing archive storage or conflicting summaries prevents price deletion and produces a failure log.

Every raw observation remains for 30 complete Tripoli days. Older observations are archived as daily mean/min/max/final values and counts through six calendar months. Each day's final quote preserves the weekly closing reference, including weeks without a Friday quote. The last available raw quote is never deleted. Archived averages are labeled as daily aggregates and cannot establish simultaneous cash/check quotes.

Existing daily summaries are not silently overwritten. If a corrected/backfilled old day conflicts with its summary, the source rows remain for an explicit rebuild/review. These changes cannot reconstruct historical data deleted before this rollout.

Local tests use isolated databases and mocked senders. They neither apply this migration nor post to production accounts.
