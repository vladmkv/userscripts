# Userscripts Sync: Decisions and Handoff

Reconstructed decisions recorded on 2026-10-27, merged on 2026-11-17 with the original handoff, which
is kept below as a historical section. No sync implementation, cloud provisioning, or publishing was
performed. Current implementation state must be verified before starting work.

Update 2026-11-17: direction changed to a collector system; see
[NOTE_ItemCollector.md](NOTE_ItemCollector.md). This note describes the earlier browser-sync design and
is superseded where it conflicts. [PLAN_UserscriptsSync.md](PLAN_UserscriptsSync.md) is stale and must
be rewritten after the collector requirements are refined.

Manual-browsing sync and weekly purge now have their own handoff:
[PLAN_UserscriptsManualSync.md](PLAN_UserscriptsManualSync.md).

## Related Documents

- [General userscripts knowledge](NOTE_Userscripts.md): implemented behavior, inspected on 2026-10-26;
	records highlighter 7.24, category selector 1.3, and item links 1.6.
- [Original handoff](#original-handoff-historical): the initial insert-only proposal, below; it predates
	the decisions in this note.
- [Detailed implementation plan](PLAN_UserscriptsSync.md): proposed SQL contracts, tests, deployment,
	rollback, and delegation boundaries. Its mandatory local journal/checkpoint design predates the final
	discussion and must not be treated as approved scope.

Repository: `.agent-tmp/userscripts`, relative to the workspace root.
Public repository: https://github.com/vladmkv/userscripts.

## Confirmed Decisions

| Topic | Decision / source in conversation |
| --- | --- |
| Goal | Same retained seen-ID history on the user's computers, with simultaneous collectors supported. |
| Protocol | User explicitly selected **per-record upsert plus change tracking**. |
| Backend | Supabase is the working backend; snapshot CAS and daily batches remain comparison alternatives, not the selected protocol. |
| Authentication | Working direction is one email/password account with independent device sessions. User explicitly selected concurrent devices now and separate-user sharing later. Never persist the password or use a privileged key in the userscript. |
| First release | User selected automatic synchronization with visible results, not notification followed by mandatory manual confirmation. Retain a Sync now action. |
| Timing | User selected checks every five active minutes and a session-start/resume check after 15 minutes idle. Do not query the database on every scroll or ordinary page navigation. |
| Browser | User selected Google Chrome with Tampermonkey. |
| Setup | At the time of questioning, the user confirmed nothing was created yet. Recheck before deployment; this is not a claim about the current remote state. |
| Capacity | 100,000 retained IDs is a configurable code constant, independent of upload batching or frequency; neither local storage nor the database should grow indefinitely. |
| Recency | Old IDs encountered again should become recent and survive pruning. User proposed ID plus timestamp and sorting rather than requiring an explicit ordered LRU queue. |
| Workload | Manually browsed pages of about 50 items, normally fewer than 1,000 new IDs per session. Do not assume a routine 100,000-entry upload queue. |
| Batching | Upload new IDs and changed timestamps in chunks. 1,000 per request was proposed, not a special requirement tied to the retention cap. |
| Overflow | User accepted ordinary oldest-entry eviction even for unsent entries; no elaborate queue-overflow workflow requested. |
| Script boundaries | Keep the three existing scripts independent. Working recommendation: integrate sync into the highlighter, with a separate sync panel, rather than install a fourth script. |
| Approvals | No source changes, cloud operations, Git writes, deletion, or publishing without the corresponding approval. Planning/document recovery is not implementation approval. |

Some earlier assistant summaries reported backend/auth/keepalive/menu decisions without their tool
records remaining visible. Preserve these as working directions, not stronger evidence than the explicit
user answers available here. The exact final script layout and restore policy should be confirmed when
locking the implementation plan, not silently inferred from an assistant recommendation.

## Latest Local-Storage Discussion

The user challenged the added journal, compaction, and cross-tab coordination work as disproportionate
for this small project. They usually interact with and scroll one tab at a time; the existing shared GM
registry has appeared to work well in actual multi-tab browsing.

The user suggested evaluating whether tabs can act as independent cloud clients, then explicitly said:
"just an idea; we dont have to separate storage yet! evaluate it first".

Consequently:
- Do not split the registry into separate tab stores as an already-made decision.
- Do not treat immutable journals, copy-on-write checkpoints, local epochs, compaction, or tab leadership
	as required implementation scope. These were assistant proposals, not accepted requirements.
- Shared registry storage and independent network requests are separate design choices; one does not
	inherently require the other.
- The final recommendation discussed was to evaluate the existing shared GM read/merge/write approach,
	with automatic sync only from a visible/focused tab and a fresh storage read immediately before saving.
	The user has not explicitly approved that final recommendation as a locked architecture.
- A same-tab in-flight guard, maximum-timestamp merges, and acknowledging only submitted versions are
	small safeguards worth evaluating without introducing a local replication subsystem.
- Durable pending changes across reload, safe pull-cursor persistence, and shared session refresh still
	require a concrete implementation choice. Do not claim that retaining the existing registry solves them.

### Risk Assessment, Not a Measured Failure Rate

The current pattern reads the latest shared registry, merges pending IDs, prunes, saves, and reads back.
Saving is skipped when there are no pending writes, so a 1.5-second scan does not mean every tab writes
every 1.5 seconds. Existing tests simulate another tab's contribution but do not establish atomicity.

With one actively browsed tab, clashes were assessed as likely uncommon, not impossible or measured.
Background initialization/retries and a late sync response after switching tabs can still overlap.
Two tabs can both read the old object and then save different additions, losing one addition despite
each having read back its own successful write. Fresh read/merge reduces stale writes but is not a lock.

An observation already uploaded may be recovered from the server; an unsent local observation lost
before upload is not automatically recoverable. A stored pull cursor can also become inconsistent if
the corresponding imported data is later overwritten. These are targeted test cases, not justification
to silently expand into a new storage architecture or promise zero data loss.

## Selected Cloud-Sync Pattern

1. Store one row per account and raw item ID, with latest actual encounter time.
2. Push only new/changed observations in batches; duplicate delivery and retries are idempotent.
3. On conflict, atomically retain the maximum encounter timestamp, not whichever request arrived last.
4. Track committed server changes independently of encounter timestamps. An offline client's old
	 encounter can arrive today, so browsing timestamps alone are not a safe download cursor.
5. Pull only changed retained rows during normal operation; initial sync/recovery may need a full pull.
6. Preserve newer local observations collected during a request; clear only acknowledged submitted values.
7. Prune by latest encounter and capacity. Propagate enough eviction information that stale clients do
	 not endlessly reintroduce old history; a genuinely newer encounter may reintroduce an old ID.
8. Use the same reconciliation engine for automatic checks and Sync now; keep scanning local-only.

The plan proposes per-account transactional revision ordering, paginated reads validated against an
expected revision, and a monotonic capacity-eviction cutoff instead of an unbounded deletion log.
These are specific engineering proposals to test, not deployed behavior or user-mandated APIs.
PostgreSQL transactions and upserts handle concurrent writers; no separately hosted backend is needed.

## Alternatives and Cost Findings

| Alternative | Benefit | Cost / reason not selected |
| --- | --- | --- |
| Manual backup/restore | Existing offline fallback; no service credentials. | Repeated manual actions have a real user cost; no automatic change detection. |
| Shared cloud-folder file picker | Familiar file transfer and merge. | User-mediated access and concurrent file replacement still need handling. |
| GitHub gist per machine | Independent machine-owned files. | Token, multiple-file reconciliation, retention, and API limitations. |
| One snapshot with conditional revision update | Simple client-side merge/prune; ordinary optimistic concurrency control. | Full retained snapshot transfer per reconciliation and retry; not normal per-record delta sync. |
| Daily change batches plus compaction | Smaller mutable working set and less repeated historical transfer. | Rollover, late uploads, duplicates, retention, and cleanup coordination add bookkeeping. |
| Per-record upsert/change tracking | Small normal transfers, chunking, and natural concurrent-ID writes. | Some SQL for max merge, commit-safe tracking, permissions, and bounded retention. Selected. |
| Separate sync userscript | Installed-code separation. | Separate GM namespaces require an explicit bridge; localStorage/IndexedDB are website-origin scoped. Not required. |

Documentation checked during discussion advertised Supabase Free with 500 MB database size, 5 GB
uncached egress per billing cycle, unlimited API requests, no automatic backups, and pausing after one
week of inactivity. Recheck current terms before provisioning.

Hypothetical 1 MB downloads at 10/50/100 downloads daily across all clients total about 0.3/1.5/3 GB
over 30 days. These were estimates, not measured payloads; a 100,000-ID timestamped representation may
be larger. Upload payload itself is not outgoing egress, but its response is. Avoid echoing full data
on write acknowledgements. Snapshot cost was not demonstrated to be a Free-plan blocker.

## Implementation and Rollout Direction

- Read the general knowledge note and current source first. Highlighter 7.24 introduced reload/title
	behavior after the original 7.23/44-test handoff; preserve that behavior and rerun the current suite.
- Narrow the plan's local-storage work to evaluation before authorizing a redesign. Keep the existing
	storage race documented and distinguish pre-existing risk from sync-induced regressions.
- Test overlapping upload/download/local saves, duplicate requests, in-flight new observations, failed
	persistence, cursor/data consistency, reload with pending uploads, and concurrent token refresh.
- Verify database maximum-timestamp merging, isolation/RLS, delayed commits, pagination/retries, pruning,
	and stale-client recovery against real authenticated sessions, not only privileged SQL-editor access.
- Keep current-visit hide/frame semantics: imported IDs do not abruptly disappear on the active page;
	the next reload incorporates them into the startup seen snapshot.
- Backup/restore migration must preserve raw IDs and account for unknown old timestamps. Merge-only
	restore while configured was a prior proposal; exact migration/Replace behavior is not a confirmed
	final design. Do not turn restore into arbitrary remote deletion.
- Keepalive working proposal: daily GitHub Action in a private repo, using a harmless endpoint and no
	user password or privileged key. Its ability to prevent pausing remains unverified; a successful ping
	alone is not proof. Local browsing should continue while cloud sync is unavailable.
- Back up both Chrome/Tampermonkey installations before pilot; update the existing script identity,
	validate two independent profiles/computers, then seek explicit publishing approval.
- No delegation has been performed here. Once the revised scope is approved, keep SQL and client work
	separately owned; do not let multiple agents concurrently edit the same highlighter/test file.

## Next Decision

Evaluate and agree the minimal local-state contract before implementing or rewriting the plan:
shared GM registry, how pending uploads survive reload, how downloaded data and its cursor are saved,
and how sessions refresh safely. Independent tabs and lock-free shared writes remain options to test,
not an approved split-storage design. No requirement for a new journal subsystem has been established.

## Original Handoff (historical)

Original text below, kept for history; superseded where it conflicts with the sections above.

Read this first in the new session. Nothing in the sync plan is implemented yet.
Public repo: github.com/vladmkv/userscripts (remote git@github.com:vladmkv/userscripts.git).
Local clone: `.agent-tmp/userscripts` (relative to workspace root).

### 1. Working rules (from the user)

- Do not commit or push without explicit approval. Everything below is currently UNCOMMITTED and unpushed.
- Git reads via the safe-command adapter (see user.instructions.md); other git ops need approval.
- ASCII only, minimal changes, no new markdown inside the repo, no absolute paths in committed files.
- User avoids bot detection: do not open marketplace pages unnecessarily; the user supplies URLs.
- Keep the three scripts separate. Icons must match their destination platform.
- Confirm before deletions. Ask with menus.
- Tampermonkey auto-updates from raw GitHub URLs, so nothing reaches the user's browser until pushed
  (or pasted manually into the Tampermonkey entry).

### 2. What exists now

Tests: `node --test .agent-tmp\userscripts\tests\userscripts.test.cjs` from the workspace root.
44 tests, all passing at the time of writing. The test file uses vm contexts with a `scan()` helper that mocks
GM storage, `unsafeWindow.localStorage`, `document` (with `fakeElement`), `window`, and timers.

Files in `.agent-tmp/userscripts`:

| File | Version | Purpose |
|---|---|---|
| `Cross-Market-Seen-Item-Highlighter.user.js` | 7.23 | Seen-item registry across Buyee, ZenMarket, Neokyo |
| `Neokyo-Category-Selector.user.js` | 1.3 | Cascading Yahoo category dropdowns on Neokyo |
| `Cross-Platform-Item-Links.user.js` | 1.6 | Panel linking one item across Buyee/ZenMarket/Neokyo |
| `README.md`, `tests/userscripts.test.cjs` | - | Docs and tests (README already documents panel, backup, restore, move) |

#### Highlighter (the one sync will change)

Storage keys (Tampermonkey `GM_getValue`/`GM_setValue`, per-script, local to the browser profile):
- `buyee_item_registry`: `{ "<itemId>": "hide" }`. Raw IDs, no marketplace prefix. Cap `MAX_TRACKED_ITEMS` = 60000 (oldest 'hide' entries pruned).
- `buyee_item_registry_migrated_origins`, `buyee_item_registry_legacy_cleanup_origins`: one-time Buyee localStorage migration markers. No legacy import remains.
- `seen_item_panel_side`: `'left'` (default) or `'right'`.

Behavior:
- Search pages only (ZenMarket `/en/search.aspx`, Neokyo `/en/search/(yahoo|mercari|yahooFleaMarket)`, Buyee `/(item|mercari)/search`):
  - IDs in the registry at page load (`seenAtPageLoad`) are hidden (wrapper `display:none`) AND painted with the red dashed frame (so "Show hidden items" shows them framed).
  - New IDs are marked seen when a card scrolls above the viewport (not Buyee Mercari) or on a bottom-of-page sweep. They are framed immediately (`seenThisVisit`) but stay visible until reload.
- ZenMarket detail pages (`product.aspx`, `auction.aspx`) record the ID and show nothing.
- Writes are batched: `markSeen()` adds to `pendingWrites`; `flushPendingWrites()` runs once per scan. It reads the latest stored registry, merges, prunes, calls `saveVerified()`
  (`GM_setValue` then read back and compare every ID), and on failure keeps IDs pending and retries with backoff 5 s doubling to 60 s (rate-limited error log).
  `GM_setValue` returns nothing, so read-back is the only success check. It may only prove the in-memory value, not disk persistence (unverified).
- Panel (shadow DOM, lower-left by default, move button remembers side): stored count, hidden-on-page count, "Not yet saved: N" (only when pending),
  Show hidden items toggle (page-only, resets on reload), Back up data (downloads JSON), Restore data, Move panel.
- Backup file: `{ format: 'cross-market-seen-items-backup', version: 1, exportedAt, itemCount, migratedOrigins, registry }`.
- Restore: file picker (max 20 MB), validates format and IDs (`^[a-zA-Z0-9_-]+$`, string values), then `confirm` = merge, `Cancel` then second `confirm` = replace.
  Pending IDs are re-added, result saved with `saveVerified`, alert on success or failure. Restored items hide after reload.
- Scan timers: 300 ms, 800 ms, scroll listener, `setInterval` 1500 ms. Grants: `GM_getValue`, `GM_setValue`, `unsafeWindow`.

#### Item Links script
Separate panel, lower-left by default with its own move button. Grants `GM_getValue`/`GM_setValue` only for `item_links_panel_side`. No network access.

### 3. Goal: sync the registry between the user's computers

The user has a second computer with Tampermonkey and wants the same scripts and the same seen-ID set on both.

Key insight (user's): the data is a set of unique IDs that only grows, with no deletes, so sync is a plain set UNION. No conflicts.
Hard part is only where the data lives. A userscript cannot reach another PC directly and cannot read local files unprompted.

Options discussed:
- A: manual Backup then Restore (merge). Works today, but is manual effort. The user pointed out they may not use the computer that often, so do not treat it as free.
- B: shared cloud folder plus a "Sync" button with a file picker each time. Small, no token.
- C: GitHub gist, one file per machine. Automatic but needs a token and network grant.
- Hosted DB. Supabase is the leading candidate (see below). MongoDB Atlas works but needs a backend because the Data API is end-of-life. Upstash Redis was an alternative (set commands `SADD`/`SMISMEMBER`).
Direction chosen so far: Supabase, planned but NOT yet decided final. See section 6.

### 4. Supabase facts checked (docs, 2026-10)

- Free plan: 500 MB database, unlimited API requests, 5 GB egress, 2 active projects, no automatic backups.
  Free projects are PAUSED after 1 week of inactivity. A paused project can be restored with one click in the dashboard for 1 year; after that only a downloadable backup remains.
  Paid plans are never paused. (supabase.com/pricing, docs "Upgrading > Time limits")
- Data API: `https://<ref>.supabase.co/rest/v1/<table>` with `apikey` header. Publishable key (`sb_publishable_...`) is meant for browsers;
  never use the secret/service_role key in a script. `anon`/`service_role` JWT keys are being deprecated by end of 2026.
- Row Level Security: enable RLS, `revoke all ... from anon, authenticated`, then grant only what is needed, plus per-operation policies. Policies use `(select auth.uid())`.
- `upsert(..., { ignoreDuplicates: true, onConflict })` exists for duplicate-safe inserts. Default max rows per select is 1000, so paginate.
- Sessions: refresh tokens never expire and are single-use (10 s reuse window); a session lasts indefinitely by default and a user may have many.
- NOT verified: whether a plain API read counts as "activity" for the pause rule; what a paused project returns to API calls; duplicate-ignoring inserts combined with RLS (needs a test).
- NOT verified: how Tampermonkey storage behaves for very large values; GitHub free-tier minutes and the 60-day scheduled-workflow rule for private repos (public-repo rule recalled from memory).

### 5. Planned design (not implemented)

#### Supabase setup (user runs in dashboard; agent supplies SQL)
```sql
create table public.seen_items (
  user_id    uuid not null default auth.uid() references auth.users(id),
  item_id    text not null check (item_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index seen_items_user_created on public.seen_items (user_id, created_at);
alter table public.seen_items enable row level security;
revoke all on public.seen_items from anon, authenticated;
grant select, insert on public.seen_items to authenticated;
create policy seen_select on public.seen_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy seen_insert on public.seen_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
```
Then: create one auth user (auto-confirmed), disable new sign-ups, and run SQL checks:
unauthenticated insert rejected; own insert ok; insert for another user_id rejected; duplicate insert is a no-op; update and delete rejected.

#### Storage format
- Remote: one row per ID (`user_id`, `item_id`, `created_at`). IDs stay raw, same as local.
- Local, existing and unchanged: `buyee_item_registry` (so backup files stay valid).
- Local, new: `seen_sync_config` (URL, publishable key, email; never the password), `seen_sync_session` (tokens),
  `seen_sync_outbox` (IDs not yet confirmed on the server, persisted so reloads do not lose them), `seen_sync_state` (pull cursor, last success, next retry).

#### Sync behavior
- Needs `@grant GM_xmlhttpRequest` and `@connect <project-ref>.supabase.co` (Tampermonkey will prompt for approval).
- Sign in via the Auth REST password grant, keep only the refresh token, serialize refresh across tabs with a lock key.
- Push: outbox in batches of 1000, insert ignoring duplicates; an ID leaves the outbox only after a success response; failures retry with backoff; first push uploads the whole local registry.
- Pull: `created_at >= cursor - 60 s`, ordered, pages of 1000; merge into the local registry via the existing `saveVerified` path. Overlap is harmless because merging is a union.
- When: page load, after scans that add IDs (at most every 30 s), and about every 10 minutes while a page is open; one tab leads via a lock.
- Panel: status line ("Sync: ok, last 14:32" / "unavailable, retrying" / "not signed in") plus "N unsynced"; buttons Set up sync (small form with a password field) and Sync now.
- Restore: restored IDs go to the outbox. Replace cannot delete server rows, so disable Replace once sync is configured.
- The 60,000 local cap stays; pruned IDs only come back on a full resync.
- Existing local scan, hide and frame logic is unchanged.

#### Keepalive (outside the userscript)
The userscript only runs while a marketplace page is open, so it cannot prevent the 1-week pause on its own.
Candidates: scheduled GitHub Action in a private repo (daily GET with the publishable key as a repo secret; optionally a tiny `keepalive()` database function)
or a Windows Task Scheduler entry on one or two owned PCs (run as soon as possible after a missed start). Or none: accept the pause and show
"sync unavailable, restore the project in the Supabase dashboard" in the panel. Whether a plain read counts as activity must be observed over one week.

#### Tests to add
Node tests with a mocked `GM_xmlhttpRequest`: outbox batching, idempotent re-push, pull merge with cursor overlap, failure and backoff, token refresh, Replace disabled when sync is on,
restore feeding the outbox. Plus the SQL checks above. Existing 44 tests must keep passing.

#### Rollout
1. Machine 1: set up sync, push, confirm server `count(*)` equals the panel count.
2. Machine 2: install the same scripts, sign in, confirm it pulls to the same count.
3. Add the keepalive (if chosen).
4. Update README.
5. Only then ask about commit and push.

### 6. Open decisions (ask the user with a menu, one at a time)

1. Confirm Supabase as the backend (vs Upstash Redis, or staying with manual backup/restore).
2. Authentication: one email+password user (planned) vs anonymous sign-in vs another method.
3. Keepalive: GitHub Action in a private repo / Task Scheduler on owned PCs / none with a clear in-panel message.
4. Disable Replace when sync is on (planned) or keep it with a warning.
5. Whether sync status and setup live in the existing panel (planned) or a separate panel.
6. When to commit and push the pending, already-tested changes (highlighter 7.23, links 1.6, README, tests). Separate from sync work. Needs explicit approval.

### 7. Risks

- Free project pauses after 1 week without activity (see keepalive). Local data keeps working while paused; new IDs queue.
- Publishable key plus credentials in Tampermonkey storage on each machine. Low-sensitivity data, but give the database no other use.
- Cross-tab refresh-token rotation races (mitigated by a lock; verify in real use).
- `GM_setValue` has no documented failure signal; read-back is a best effort.
- Nothing has been tested in a real browser for the new panel, backup, restore or move features, only in the vm tests.

### 8. First steps for the next session

1. Read this note and run the test command above to confirm 44/44 passing.
2. Ask the open decisions in section 6 (menu, one at a time).
3. Draft the SQL and a verification script for the user to run in the Supabase dashboard; do not touch the userscript until the database checks pass.
4. Then implement the userscript sync in small steps with tests, and update the README.
