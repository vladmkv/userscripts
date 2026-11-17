# Seen-Item Sync and Weekly Purge: Handoff Plan

Companions: [NOTE_Userscripts.md](NOTE_Userscripts.md) (implemented behavior, last full review at v7.24),
[NOTE_UserscriptsSync.md](NOTE_UserscriptsSync.md) (earlier sync design, superseded where it conflicts),
[NOTE_ItemCollector.md](NOTE_ItemCollector.md) (future collector system, separate track).
Date: 2026-11-17. Status: handoff; state verified, approach proposed, nothing implemented.
Repository: `.agent-tmp/userscripts` (https://github.com/vladmkv/userscripts).

## Scope

Complete the manual-browsing part independently of the future collector:
1. Sync the highlighter's seen-item registry between two Chrome/Tampermonkey browsers, the cheapest way
   that works reliably.
2. Purge items not encountered on any page for over a week.
3. Treat all existing stored items as new: assign them today's timestamp on migration.

Out of scope: the collector, per-query streams, marketplace-qualified IDs (draft in
[PLAN_UserscriptsIdentity.md](PLAN_UserscriptsIdentity.md)), discovered-vs-viewed state.
[PLAN_UserscriptsSync.md](PLAN_UserscriptsSync.md) is superseded for this scope; do not implement its
journals, change revisions, eviction cutoffs, or 100,000-item retention.

Working rules: source edits, cloud setup, Git writes, and publishing each need explicit user approval.
ASCII only, minimal changes, reuse existing helpers and the existing test harness.

## Verified State (2026-11-17)

- Git: `main...origin/main`, HEAD `d61a80e Add development notes`. Only uncommitted changes are notes in
  `kb/` (`NOTE_UserscriptsSync.md` modified, `NOTE_ItemCollector.md` untracked). `kb/` is tracked and
  public in the repo.
- Highlighter `Cross-Market-Seen-Item-Highlighter.user.js` is v7.33 (NOTE_Userscripts.md describes 7.24).
  Since then: eBay search support (`ebay_<id>` IDs, optional eBay auto refresh), ID validation
  (`ID_PATTERN = /^[a-zA-Z0-9_:-]+$/`), legacy-ID fixing, and safer restore.
- Grants: `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `unsafeWindow`. No network grant.
- Registry: `buyee_item_registry` = `{ "<rawId>": "hide" }`. No timestamps. Membership is checked as
  `=== 'hide'` in several places (for example the card loop in `processStateEngine` and the detail-page
  paint check).
- Writes: `markSeen()` queues IDs in `pendingWrites`; `flushPendingWrites()` rereads the stored registry,
  merges, prunes, and saves with read-back verification (`saveVerified`). Not transactional across tabs.
- Bulk changes (restore, merge, fix IDs) use `commitRegistry()`: writes a snapshot
  (`buyee_item_registry_previous`) and a staged copy (`buyee_item_registry_staged`) before replacing the
  main key, and rolls back on failure. Reuse this for migration and purge.
- Pruning: `MAX_TRACKED_ITEMS = 60000`, removes entries in object key order (not recency); marked
  untested at the cap by a REVIEW comment.
- Already-seen items return early in the card loop; nothing records that they were seen again.
- Panel buttons: Show hidden items, Back up data, Restore data (replace), Merge data, Fix invalid IDs,
  Move panel, and on eBay Enable auto refresh. Backup format `cross-market-seen-items-backup` version 1.
- Manual two-browser sync already works today: Back up data on one browser, Merge data on the other.
- Tests: `node --test --test-reporter=dot .agent-tmp\userscripts\tests\userscripts.test.cjs` from the
  workspace root: 88 tests, 81 pass, 7 fail. All 7 failures are Cross-Platform Item Links auction-check
  tests (price, closing time, retry timing), pre-existing and unrelated to the highlighter.
- Workload (user estimate): about 100 new IDs per browsing session, at most about 1,000 per day, collected
  over roughly an hour. Current registry about 35,000 IDs. One browser in use at a time; several tabs.

## Proposed Approach

### Local format and purge (needed for every sync option)

- Change each registry value from `"hide"` to the last-seen time, integer milliseconds. Membership becomes
  "key present" instead of `=== 'hide'`; update every such check.
- Migration (one time, through `commitRegistry`): every existing entry gets today's timestamp, as the user
  decided. Consequence to state in the README: about 7 days after migration, every item not seen again
  since is purged at once and can show again if it reappears.
- Record encounters: when a card with a known ID is processed, refresh its last-seen time once per page
  visit (a per-visit Set), batched through the existing `pendingWrites` flush. New IDs get the current time.
- Merging two registries keeps the larger timestamp per ID. Use this in `flushPendingWrites`, Merge data,
  and sync.
- Purge: remove entries with last-seen older than `PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000`. Run it
  during the normal flush and before any sync upload, not on every scan. Keep `MAX_TRACKED_ITEMS` as a
  safety cap, now pruning oldest timestamps first.
- Backup format version 2 carries timestamps. Version 1 files import with the current time for every ID.
- Expected size after purge: roughly the IDs seen in the last week (at most about 7,000 at the stated
  workload), far below today's 35,000, so GM storage size stops being a concern.

### Sync options (cheapest first)

| Option | How it works | Cost | Risks |
| --- | --- | --- | --- |
| A. Manual Back up + Merge | Existing buttons; merge keeps max timestamp. | No new code beyond the timestamp merge. | Manual steps on both browsers; easy to forget. |
| B. Supabase single-row snapshot (recommended) | One table row per account: `revision` and the registry JSON. Client reads the row, merges by max timestamp, purges, then updates only if `revision` is unchanged; on conflict it rereads and retries. | Free tier; one table, row-level security, one email/password user; `GM_xmlhttpRequest` plus `@connect` to the project host. A week-purged registry is a few hundred KB. | Free project pauses after a week of inactivity; credentials in Tampermonkey storage; token refresh handling. |
| C. Private GitHub Gist | Same snapshot JSON in a gist, read and written with a personal token. | No new service; one token. | No conditional write, so two browsers syncing at the same moment can lose an update; token in Tampermonkey storage. |
| D. Home server endpoint | Small HTTP service and file/SQLite on the future collector host. | Reuses planned hardware. | Needs exposure to the internet or a VPN; server does not exist yet. |

Recommendation: B. It is the cheapest option that is automatic and safe when both browsers sync at
once, and the snapshot stays small because of the weekly purge. Per-record upsert and change tracking
are not needed at this size. If the user prefers zero setup, ship A first (timestamps, purge, max-merge)
and add B later without changing the local format.

Sync behavior for B (proposal): sync at page load, then every 5 minutes on search pages and after new
items are saved (at most once a minute), from the tab that triggers it. Show a panel line with the last
successful sync time and a persistent warning if sync fails. Keep current-visit display unchanged:
synced IDs take effect on the next reload.

## Sync Safety (option B)

Merge guarantee: a sync never replaces one side with the other. It reads the cloud row and its
`revision`, takes the union with local (max timestamp per ID), purges, saves locally, then uploads only
if `revision` is unchanged; otherwise it rereads and repeats. Union never removes an ID; only the
purge does, and every browser applies the same rule. No locks, so no deadlock. Deletions do not
propagate: Restore (replace) on one browser cannot remove IDs from the other (accepted).

Decisions (2026-11-17):
- Tabs share one Tampermonkey store per browser, but each tab syncs on its own. Correctness comes from
  the revision check. Shared `sync_last_at` key: a tab skips sync if another tab synced under 1 minute
  ago (saves requests only). Conflict retries: at most 3, random 1-3 s delay, then warning.
- Local multi-tab overwrite (not observed so far, cheap fix): after a verified save, keep the IDs in an
  `unconfirmedWrites` set; the next flush rereads storage, requeues any that are missing, and drops the
  confirmed ones. Sync's local save also rereads and merges immediately before writing.
- Conditional update: a PATCH filtered on `revision` that matches 0 rows is a conflict, never success.
  Must be covered by a test.
- Invalid cloud data (unparseable, wrong shape, invalid IDs or timestamps): stop syncing, show a
  persistent panel error, change nothing locally or in the cloud. The panel offers "Download server data"
  to inspect it, and only after that "Overwrite server with local data" (explicit confirm).
- Cloud backup: the row also holds `backup` and `backup_at`, the last valid registry. Refreshed from a
  successful sync at most once per 24 h, so a bad upload cannot reach the backup immediately. Panel
  offers "Restore from cloud backup" (merge into local, then a normal sync). README tells the user to
  report bad data at once while the backup is still good. Local `buyee_item_registry_previous` remains
  as a second copy.
- Timestamps: invalid, non-numeric, or before 2020 values are treated as "seen now" instead of being
  purged. Values more than 10 minutes in the future are clamped to now. Clock differences of a few
  minutes are harmless against a 7-day purge. Clock check: compare local time with the server
  `Date` response header; if they differ by more than 10 minutes, skip purge and upload and warn.
- Purge runs through a snapshot (`commitRegistry`), and the exact 7-day boundary is tested.

## Tasks

1. [DONE] Confirm decisions with the user. Outcome (2026-11-17): option B (Supabase); purge after 7
   days; migration with today's timestamp approved, including the day-7 mass purge; add a manual
   keep-forever mark. Supabase project not yet created.
2. [TODO] **high** Add timestamped registry values, migration via `commitRegistry`, encounter refresh,
   max-timestamp merge, and weekly purge with the timestamp validation and clamping from Sync Safety.
   Update the tests that assert `'hide'` values.
3. [TODO] **high** Keep-forever mark: registry value `"forever"` is never purged; merge rule: `"forever"`
   wins over any timestamp. Un-pinning does not sync (union keeps `"forever"`), same as deletions; accept
   or add later. Open: how to mark an item (button on the card, panel field for an ID, or a hotkey);
   ask before implementing. Note: items that keep appearing already stay hidden, because every
   encounter refreshes their timestamp; pinning helps only items absent for over a week that return
   with the same ID.
4. [TODO] **high** Local multi-tab fix: `unconfirmedWrites` set, recheck on the next flush, requeue
   missing IDs. Independent of the sync option.
5. [TODO] **high** Backup format version 2 with timestamps; version 1 import assigns the current time.
6. [TODO] **medium** If B: SQL for the table (`registry`, `revision`, `backup`, `backup_at`), row-level
   security, and grants; verify with an authenticated session that another user's row cannot be read or
   written.
7. [TODO] **medium** If B: client sync (setup form without storing the password, conditional update
   where 0 matched rows means conflict, at most 3 retries with jitter, `sync_last_at` tab dedupe, clock
   check against the server `Date` header, status line, failure warning). Add `@grant GM_xmlhttpRequest`
   and an exact `@connect` host.
8. [TODO] **medium** If B: invalid-cloud-data handling (stop, error, Download server data, explicit
   Overwrite server) and the 24 h cloud backup with Restore from cloud backup.
9. [TODO] **medium** Tests: migration timestamps, encounter refresh once per visit, max merge, purge
   boundary at exactly 7 days, invalid and future timestamps, unconfirmed-write requeue, version 1 and 2
   import, 0-row conditional update treated as conflict, retry limit, invalid cloud data stops sync,
   backup refresh at most once per 24 h, sync failure warning. Existing highlighter tests must keep
   passing; the 7 item-links failures are pre-existing.
10. [TODO] **medium** Verify in Chrome on both browsers: migration, purge, merge or sync convergence,
   panel status. Back up Tampermonkey data on both browsers first.
11. [TODO] **low** Update README (day-7 mass purge, deletions and un-pinning do not sync, report bad data
    quickly) and bump the highlighter version; then ask about commit and push.

## Devlog

- 2026-11-17: Ran the offline suite to set a baseline: 81 of 88 pass. The 7 failures are all
  Cross-Platform Item Links auction-check tests, unrelated to this work; recorded rather than fixed.
- 2026-11-17: The user scoped this work to manual browsing, separate from the collector. Weekly purge
  bounds the registry to roughly one week of items, which makes a single-row snapshot cheaper than the
  earlier per-record design; recommended option B with A as a zero-setup fallback.
- 2026-11-17: Reviewed how sync could clash or lose data with the user. Recorded the decisions in Sync
  Safety: tab dedupe, a cheap local multi-tab fix, 0-row update treated as conflict, invalid cloud data
  stops sync and needs an explicit overwrite, a cloud backup refreshed at most once a day, and timestamp
  validation with a 10-minute clock tolerance.
- 2026-11-17: Task 1 decided: option B (Supabase), 7-day purge, migration with today's timestamp
  approved, and a manual keep-forever mark added as task 3 (how to mark is still open).
