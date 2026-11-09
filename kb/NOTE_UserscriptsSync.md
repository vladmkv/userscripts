# Handoff: userscripts suite and planned Supabase sync

Read this first in the new session. Nothing in the sync plan is implemented yet.
Public repo: github.com/vladmkv/userscripts (remote git@github.com:vladmkv/userscripts.git).
Local clone: `.agent-tmp/userscripts` (relative to workspace root).

## 1. Working rules (from the user)

- Do not commit or push without explicit approval. Everything below is currently UNCOMMITTED and unpushed.
- Git reads via the safe-command adapter (see user.instructions.md); other git ops need approval.
- ASCII only, minimal changes, no new markdown inside the repo, no absolute paths in committed files.
- User avoids bot detection: do not open marketplace pages unnecessarily; the user supplies URLs.
- Keep the three scripts separate. Icons must match their destination platform.
- Confirm before deletions. Ask with menus.
- Tampermonkey auto-updates from raw GitHub URLs, so nothing reaches the user's browser until pushed
  (or pasted manually into the Tampermonkey entry).

## 2. What exists now

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

### Highlighter (the one sync will change)

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

### Item Links script
Separate panel, lower-left by default with its own move button. Grants `GM_getValue`/`GM_setValue` only for `item_links_panel_side`. No network access.

## 3. Goal: sync the registry between the user's computers

The user has a second computer with Tampermonkey and wants the same scripts and the same seen-ID set on both.

Key insight (user's): the data is a set of unique IDs that only grows, with no deletes, so sync is a plain set UNION. No conflicts.
Hard part is only where the data lives. A userscript cannot reach another PC directly and cannot read local files unprompted.

Options discussed:
- A: manual Backup then Restore (merge). Works today, but is manual effort. The user pointed out they may not use the computer that often, so do not treat it as free.
- B: shared cloud folder plus a "Sync" button with a file picker each time. Small, no token.
- C: GitHub gist, one file per machine. Automatic but needs a token and network grant.
- Hosted DB. Supabase is the leading candidate (see below). MongoDB Atlas works but needs a backend because the Data API is end-of-life. Upstash Redis was an alternative (set commands `SADD`/`SMISMEMBER`).
Direction chosen so far: Supabase, planned but NOT yet decided final. See section 6.

## 4. Supabase facts checked (docs, 2026-10)

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

## 5. Planned design (not implemented)

### Supabase setup (user runs in dashboard; agent supplies SQL)
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

### Storage format
- Remote: one row per ID (`user_id`, `item_id`, `created_at`). IDs stay raw, same as local.
- Local, existing and unchanged: `buyee_item_registry` (so backup files stay valid).
- Local, new: `seen_sync_config` (URL, publishable key, email; never the password), `seen_sync_session` (tokens),
  `seen_sync_outbox` (IDs not yet confirmed on the server, persisted so reloads do not lose them), `seen_sync_state` (pull cursor, last success, next retry).

### Sync behavior
- Needs `@grant GM_xmlhttpRequest` and `@connect <project-ref>.supabase.co` (Tampermonkey will prompt for approval).
- Sign in via the Auth REST password grant, keep only the refresh token, serialize refresh across tabs with a lock key.
- Push: outbox in batches of 1000, insert ignoring duplicates; an ID leaves the outbox only after a success response; failures retry with backoff; first push uploads the whole local registry.
- Pull: `created_at >= cursor - 60 s`, ordered, pages of 1000; merge into the local registry via the existing `saveVerified` path. Overlap is harmless because merging is a union.
- When: page load, after scans that add IDs (at most every 30 s), and about every 10 minutes while a page is open; one tab leads via a lock.
- Panel: status line ("Sync: ok, last 14:32" / "unavailable, retrying" / "not signed in") plus "N unsynced"; buttons Set up sync (small form with a password field) and Sync now.
- Restore: restored IDs go to the outbox. Replace cannot delete server rows, so disable Replace once sync is configured.
- The 60,000 local cap stays; pruned IDs only come back on a full resync.
- Existing local scan, hide and frame logic is unchanged.

### Keepalive (outside the userscript)
The userscript only runs while a marketplace page is open, so it cannot prevent the 1-week pause on its own.
Candidates: scheduled GitHub Action in a private repo (daily GET with the publishable key as a repo secret; optionally a tiny `keepalive()` database function)
or a Windows Task Scheduler entry on one or two owned PCs (run as soon as possible after a missed start). Or none: accept the pause and show
"sync unavailable, restore the project in the Supabase dashboard" in the panel. Whether a plain read counts as activity must be observed over one week.

### Tests to add
Node tests with a mocked `GM_xmlhttpRequest`: outbox batching, idempotent re-push, pull merge with cursor overlap, failure and backoff, token refresh, Replace disabled when sync is on,
restore feeding the outbox. Plus the SQL checks above. Existing 44 tests must keep passing.

### Rollout
1. Machine 1: set up sync, push, confirm server `count(*)` equals the panel count.
2. Machine 2: install the same scripts, sign in, confirm it pulls to the same count.
3. Add the keepalive (if chosen).
4. Update README.
5. Only then ask about commit and push.

## 6. Open decisions (ask the user with a menu, one at a time)

1. Confirm Supabase as the backend (vs Upstash Redis, or staying with manual backup/restore).
2. Authentication: one email+password user (planned) vs anonymous sign-in vs another method.
3. Keepalive: GitHub Action in a private repo / Task Scheduler on owned PCs / none with a clear in-panel message.
4. Disable Replace when sync is on (planned) or keep it with a warning.
5. Whether sync status and setup live in the existing panel (planned) or a separate panel.
6. When to commit and push the pending, already-tested changes (highlighter 7.23, links 1.6, README, tests). Separate from sync work. Needs explicit approval.

## 7. Risks

- Free project pauses after 1 week without activity (see keepalive). Local data keeps working while paused; new IDs queue.
- Publishable key plus credentials in Tampermonkey storage on each machine. Low-sensitivity data, but give the database no other use.
- Cross-tab refresh-token rotation races (mitigated by a lock; verify in real use).
- `GM_setValue` has no documented failure signal; read-back is a best effort.
- Nothing has been tested in a real browser for the new panel, backup, restore or move features, only in the vm tests.

## 8. First steps for the next session

1. Read this note and run the test command above to confirm 44/44 passing.
2. Ask the open decisions in section 6 (menu, one at a time).
3. Draft the SQL and a verification script for the user to run in the Supabase dashboard; do not touch the userscript until the database checks pass.
4. Then implement the userscript sync in small steps with tests, and update the README.
