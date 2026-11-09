# Userscripts: General Development Handoff

Source inspected: 2026-10-26. This describes implemented functionality, not proposed sync.
Local repository: `.agent-tmp/userscripts`, relative to the workspace root.
Public repository: https://github.com/vladmkv/userscripts.
Sync background: [NOTE_UserscriptsSync.md](NOTE_UserscriptsSync.md).
Latest sync implementation plan: [PLAN_UserscriptsSync.md](PLAN_UserscriptsSync.md).
Read the latest plan for sync decisions; the older note contains superseded proposals.

## Scope and Working Rules

- Three independent Chrome/Tampermonkey scripts; no build step, package installation, or framework.
- Keep them separate and preserve installed script names/namespaces to avoid losing access to stored data.
- Source changes, Git writes, remote setup, and publishing require the user's corresponding approval.
- Do not open marketplace pages unnecessarily: bot detection matters; use user-supplied URLs and local fixtures.
- Use ASCII, minimal changes, existing styles and test helpers. No new repository Markdown without approval.
- Keep development notes outside the repository. Do not commit registry exports, credentials, or browsing history.
- Local Git reads use the safe-command skill adapter. Do not silently discard other sessions' changes.
- Manual transfer and repeated user actions have a real cost; prefer automation when requested.

## Verified Source Snapshot

| File under `.agent-tmp/userscripts` | Version | Responsibility |
| --- | --- | --- |
| `Cross-Market-Seen-Item-Highlighter.user.js` | 7.24 | Seen-ID tracking, hiding/framing, backup/restore, alerts, automatic reload |
| `Neokyo-Category-Selector.user.js` | 1.3 | Neokyo Yahoo category selection and locking |
| `Cross-Platform-Item-Links.user.js` | 1.6 | Item-page links between proxy platforms |
| `tests/userscripts.test.cjs` | n/a | Node built-in test runner and VM/DOM/storage/timer mocks |
| `README.md` | n/a | Existing installation and usage documentation |

Local `git status --short --branch` returned `## main...origin/main` with no changes.
This is local tracking information, not a fresh remote fetch or proof of what is installed in Chrome.
Do not repeat the older handoff's claim that all changes are still uncommitted.
The README does not yet describe the v7.24 reload/title-alarm behavior; source is authoritative.

## Seen Item Highlighter

### Page Coverage and Identity

- Buyee search: `/item/search*`, `/mercari/search*`.
- ZenMarket search: `/en/search.aspx*`; detail recording: `/product.aspx*`, `/auction.aspx*`.
- Neokyo search: `/en/search/yahoo*`, `/en/search/mercari*`; Yahoo prefix also matches Yahoo Flea Market.
- Buyee detail metadata also exists, but the state engine does not record or decorate Buyee detail pages.
- The Buyee Mercari detail `@match` currently ends at `/mercari/item/` without a wildcard; do not assume all detail URLs match.
- Buyee, ZenMarket, and Neokyo IDs are case-preserved raw strings, without a marketplace prefix. Identical IDs across unrelated markets collide.
- `getItemId()` parses Neokyo product paths, ZenMarket `itemCode`, the existing Buyee regex, and eBay item paths.
- `getTargetListingCards()` owns selectors; hiding a grid wrapper avoids leaving empty grid slots.
- Neokyo Yahoo uses `.product-card.auction`; Mercari/Flea links resolve to their nearest card.
- ZenMarket uses product/auction anchors and hides their nearest `.product` wrapper.
- Buyee tries top-level list items first, then alternative item-card classes.

### ID Storage Decision: eBay (2026-11-09)

- Store eBay listing IDs as `ebay_<numeric-id>`, for example `ebay_267830127486`, in the existing `buyee_item_registry` with value `"hide"`. This distinguishes eBay from ordinary raw IDs without changing or migrating existing entries.
- Buyee extracts its item ID from the item URL; Neokyo extracts it from `/en/product/<marketplace>/<id>`; ZenMarket uses the `itemCode` query parameter. These three store the extracted ID as-is, with no proxy-site or marketplace field.
- Consequently the same raw ID from different proxies is treated as the same item, which supports cross-proxy tracking when they refer to the same underlying listing. The same raw ID from unrelated markets also collides; raw IDs are not guaranteed to identify their marketplace.
- The eBay prefix avoids collisions with unprefixed numeric IDs but is not a reserved namespace: a pre-existing raw ID identical to `ebay_<numeric-id>` would still collide.
- All IDs share one local Tampermonkey registry and the same 60,000-entry limit. No item type or encounter timestamp is stored as a separate field; cloud sync remains unimplemented.

### Seen-State Rules

`processStateEngine()` reads shared GM storage, selects cards, and applies these rules:

1. IDs in `seenAtPageLoad` are hidden and painted with the same red frame as newly seen items.
2. IDs in `seenThisVisit` remain visible and framed until reload.
3. IDs added by another tab after startup do not suddenly hide or frame cards on this visit.
4. A new card is recorded once it has completely left the viewport above, or when it qualifies for a bottom-of-page sweep.
5. Buyee Mercari uses bottom sweeps only, not the above-viewport rule.

`paintSeenItem()` applies a 4px dashed red border and pale red background.
`hideSeenItem()` paints the card, adds its wrapper/card to `hiddenElements`, and sets display.
Painting before hiding is intentional: revealing hidden elements immediately shows the red frame.
The Show hidden items toggle changes page visibility only; it does not remove registry IDs and resets on reload.
`hiddenElements` counts tracked DOM targets, not unique item IDs; it is not pruned for detached nodes.
Newly recorded search IDs dispatch `buyeeItemSeen` with `detail.id`.
ZenMarket detail visits record their ID without framing/hiding, unless recognizable security-challenge text is present.

### Local Storage and Writes

All GM keys belong to this script's Tampermonkey storage, shared across its matched sites in that installation.
There is no implemented cross-computer sync or cloud transport.

| Key | Current value |
| --- | --- |
| `buyee_item_registry` | Object mapping raw IDs or eBay-prefixed IDs to `"hide"` |
| `buyee_item_registry_migrated_origins` | Historical migration-origin array |
| `buyee_item_registry_legacy_cleanup_origins` | Origins whose obsolete localStorage copy was removed |
| `seen_item_panel_side` | `left` or `right`; default left |

`markSeen()` queues IDs in an in-memory `pendingWrites` Set.
`flushPendingWrites()` merges those IDs into a fresh stored copy, prunes, and writes once per scan.
`saveVerified()` reads back and checks the expected entries; it does not establish disk durability or exact replacement.
Failed writes remain pending and retry after 5 seconds, doubling up to 60 seconds, with deduplicated errors.
Pending writes are not durable across closing/reloading the page; automatic reload postpones while pending.
Concurrent whole-object writes are not transactional, even though each writer merges before saving.
Current retention is 60,000 entries, pruning `hide` entries in object enumeration order, not timestamp-based recency.
No encounter timestamps or durable outbox exist in the current format.
Buyee legacy cleanup runs only for origins already marked migrated; unmarked localStorage is left untouched.
There is no current legacy import, despite a stale ZenMarket diagnostic suggesting otherwise.

### Panel and Backup

- Shadow-DOM panel on search pages: stored count, hidden-target count, unsaved count, reveal toggle, backup, restore, move.
- Each move saves the side in GM storage; the panel stays bottom-left or bottom-right across reloads/sites.
- Backup downloads JSON containing `format`, `version`, `exportedAt`, `itemCount`, `migratedOrigins`, and `registry`.
- Format identifier: `cross-market-seen-items-backup`, version 1. Pending IDs are included in the export.
- Restore accepts a selected JSON file up to 20 MB, validates format and ID grammar, and accepts string-valued registry entries.
- First confirmation selects merge; cancelling offers a separate replace confirmation; cancelling that changes nothing.
- Pending IDs are re-added and retention pruning applies before verified saving. Restored membership takes effect after reload.
- Restore currently restores the registry only, not exported migration markers or panel settings.

### Timers, Reload, and Title Alarm (v7.24)

- Initial scans after 300 and 800 ms, scans on scroll, and a periodic scan every 1,500 ms.
- Search pages schedule a reload after a random 5-10 minutes.
- Reload attempts flush pending writes; unsaved IDs or scrolling within the last 30 seconds postpone by one minute.
- With remaining unseen cards, the tab title alternates red/blue circle markers every random 300-1,000 ms and includes the count.
- When no unseen cards remain, the alarm stops and restores the captured original title.
- These features run on search pages, not detail pages; there are no panel switches for them currently.
- Grants: `GM_getValue`, `GM_setValue`, `unsafeWindow`; no cloud request grant.

## Neokyo Yahoo Category Selector

- Runtime scope is English Yahoo Auction search only, not Mercari or Yahoo Flea Market despite broad metadata.
- Renders before `#yahoo-filter-form`, otherwise at the start of the body; separate from the floating panels.
- Cascading dropdowns follow the Yahoo hierarchy. Default path: `0,23632,23764,23848,44762` (cassette players).
- `categoryUrl()` preserves other filters, removes obsolete descendants, optionally resets pagination to page 1.
- Applying a category resets pagination; repairing a locked URL preserves its current page.
- Optional Lock category persists selection through navigation links, form submission, and FormData creation.
- Selecting all categories and applying disables the lock.
- `getChildren()` fetches same-origin `/api/v1/categories/yahoo/children?level=...&category_id=...`.
- In-memory cache plus persistent 30-day cache avoids repeat requests.
- HTTP 429 honors Retry-After (seconds/date), otherwise 15 minutes, with a minimum one-minute cooldown; stale cache remains usable.
- `renderVersion` prevents late asynchronous responses from replacing a newer selection.
- GM settings key: `neokyo_yahoo_category_selector`, value `{locked, path}`.
- Cache key: `neokyo_yahoo_category_cache_v1`, entries keyed `level:parentId` with `{savedAt, rows}`.
- Cooldown key: `neokyo_yahoo_category_retry_after`, epoch milliseconds.
- Grants: `GM_getValue`, `GM_setValue`; category reads use normal same-origin fetch.

## Cross-Platform Item Links

- Runs on supported item pages only; identifies the marketplace from path/shop, never ID prefix.
- Buyee routes: `/item/jdirectitems/auction/<id>`, `/mercari/item/<id>`, `/paypayfleamarket/item/<id>`.
- Neokyo routes: `/en/product/yahoo/<id>`, `/en/product/mercari/<id>`, `/en/product/yahooFleaMarket/<id>`.
- ZenMarket: `/auction.aspx?itemCode=...`, or `/product.aspx?shop=mercari|yahooFleaMarket&itemCode=...`.
- `identifyItem()` validates host/path/ID; `destinationLinks()` constructs three destinations without tracking parameters.
- Shadow-DOM panel shows vertically stacked platform links with each destination's own favicon.
- Links open new tabs with `noopener noreferrer`; current platform is marked with `aria-current`.
- Bottom-left default; move button persists side in `item_links_panel_side`, independently of the highlighter.
- Grants: `GM_getValue`, `GM_setValue`; does not access the highlighter registry.
- No background item-page requests; favicon images can trigger normal browser requests.
- ZenMarket Flea Market route is a user-specified assumption, not live-verified; Shopping is deliberately excluded.

## Development and Verification

From the workspace root, run the complete offline suite:

```powershell
node --test --test-reporter=dot .agent-tmp\userscripts\tests\userscripts.test.cjs
```

Use a current Node release; the harness uses built-in test, VM, Blob, structuredClone, and findLast.
Reuse `scan()`, `fakeElement()`, `findByAction()`, `panelText()`, and category API mocks rather than adding frameworks.
Timers are captured for deterministic invocation; marketplace navigation and live category requests are not required by tests.
Coverage includes storage/hiding/framing, restore, panel position, category cache/rate limiting, links and URL validation, reload and title alarm.
VM success is not Chrome/Tampermonkey end-to-end evidence; verify actual grants, downloads, file picking, layout, and site selectors separately when authorized.
Test result for this handoff: pending fresh run; historical 44-test counts in the older note are not the current baseline.

For continued work: read the relevant owning function and neighboring tests, agree the requested scope, make a small change, then run the full relevant suite.
Avoid installation churn: update the existing Tampermonkey entry, preserve name/namespace and storage, and back up valuable registry data before migration.
All scripts publish from `https://raw.githubusercontent.com/vladmkv/userscripts/main/<filename>` through updateURL/downloadURL.
ALWAYS bump the touched userscript's `@version` with every edit, even a small bug fix (standing user rule, 2026-11-03). Bump for a release, obtain separate commit/push approval, then reload existing site tabs after updating.
Do not assume local source, origin tracking refs, GitHub main, and the installed Tampermonkey version are identical.

## Sync Boundary

Supabase sync is planned, not implemented. Do not infer cloud readiness from the existence of notes.
The newer plan changes storage, retention, delivery, and UI; it supersedes the earlier simple union-only proposal.
For general feature work, preserve current behavior and avoid implementing that separate plan without approval.
For sync work, read both companion documents, especially the decisions and gates in PLAN_UserscriptsSync.md.

## Data Tools Design: Validate, Restore, Merge, Fix (agreed 2026-11-03, implemented uncommitted)

Target: Highlighter v7.29 -> 7.30. Minimum tool set: Export (Back up data), Import as Replace or Merge, Fix.
Status: implemented in the working tree 2026-11-03 (adds `@grant GM_deleteValue` for the staging key); not committed.
Tests: 83 run, 76 pass; the 7 failures are auction-monitor tests that fail identically on HEAD (pre-existing).

### Evidence: why restore rejected existing exports

`isValidRegistry()` requires every ID to match `/^[a-zA-Z0-9_-]+$/` and rejects the whole file on one failure.
Analysis of three exports in `%USERPROFILE%\Downloads` (2026-10-24/26/30; 33k-35k entries each)
with `.agent-tmp/runs/20261103-registry-validate/analyze.cjs` (read-only):

- Values: all strings, `"hide"` plus 11 `"kept"`. No invalid values.
- 26 invalid IDs per file, the same in all three:
  - 23 with `:`, of the form `<shop>:<code>`.
    Legitimate ZenMarket shop itemCodes; `getItemId()` stores the raw `itemCode`. `:` must be allowed.
  - 3 legacy junk IDs of the form `<auction-id>,conversionType=jdirectitems_auction_DirectSearch`.
    Buyee auction ID with a tracking suffix from an older extraction; the real ID is the part before `,`.
    The current `ORIGINAL_SEARCH_REGEX` stops at `,`, so new ones are not produced by Buyee code.

### ID rule

- `ID_PATTERN = /^[a-zA-Z0-9_:-]+$/`; value must be a string.
- Fixable: `X,anything` where `X` passes `ID_PATTERN`; fix rewrites it to `X`.
  If `X` already exists its value is kept, otherwise the old value moves to `X`.
- Unfixable: any other ID failing the pattern, or a non-string value.
- Record-time check: `markSeen()` (single choke point for all sites) refuses IDs failing the pattern,
  logs a warning once per ID, stores nothing. Effectively affects ZenMarket only.

### Import (Restore = replace, Merge = additive)

Shared steps for both buttons (same file picker and 20 MB limit):

1. Parse; wrong format or invalid JSON keeps the existing "not a seen-items backup" alert.
2. Fixable legacy IDs in the incoming data are fixed automatically in memory before anything is written.
3. Unfixable entries are listed with a reason (up to 10 in the dialog, then "...and K more (see console)"),
   e.g. `"c123,foo=bar": character "," not allowed`, `"abc": value is a number, not text`.
   All are logged to the console. Confirm: `Skip U invalid entries and continue?`
   OK = skip them and continue; Cancel = abort, nothing changes.
4. Preview and confirm (Cancel changes nothing):
   - Merge: `Add N new items. M incoming items already stored. K existing items are not in the file and will be kept.`
     Plus `F legacy IDs will be fixed (e.g. ...)` and a prune count if the result exceeds 60,000.
   - Restore (replace-only): `Replace all S stored items with the F items from the file. L stored items are not in the file and will be lost.`
     Plus the legacy-fix line and prune count when applicable.
5. Merge result = existing stored registry, then new incoming IDs appended (existing values never overwritten;
   local IDs keep their position, which matters because pruning removes oldest-enumerated `hide` entries first).
   Replace result = incoming registry. In both: pending IDs re-added, then `pruneRegistry()`.
6. Commit through the safe write pipeline below.

Restore's current two-step merge-or-replace dialog is replaced by replace-only; merging moves to the Merge button.

### Fix invalid IDs (manual, stored data)

- Panel button "Fix invalid IDs", shown only when the stored registry contains invalid IDs.
  Checked when the panel is created and after each restore, merge, or fix; not on every scan.
- Preview: `Fix N legacy IDs (e.g. ... -> ...). U invalid IDs cannot be fixed and will stay (see console).`
- Cancel changes nothing. OK commits through the safe write pipeline. Nothing runs automatically at page load.
- Unfixable stored IDs are left in place and logged.

### Safe write pipeline (Merge, Replace, Fix)

1. Build and validate the complete candidate in memory (IDs, values, exact count, merge/replace result).
   Any failure: discard the candidate; storage untouched.
2. Keep `before` = current stored registry in memory.
3. Write `before` to the snapshot key `buyee_item_registry_previous` and read it back.
   Failure: stop; main key untouched.
4. Write the candidate to the staging key `buyee_item_registry_staged` and read it back
   (every entry matches and the key count is exact). Failure: delete staging, discard; main key untouched.
5. Write the candidate to `buyee_item_registry`, read back with the same exact check, then delete staging.
6. Only if step 5 fails (unlikely after step 4): write `before` back and verify; alert `Failed; previous data was put back.`
   If that rollback also fails: alert and offer to download `before` from memory as a backup file,
   which can later be restored with Replace.

Existing `saveVerified()` only checks that expected entries are present; it does not detect extra keys,
which matters for Replace. The pipeline adds the exact count check.

### Recovery levels

1. Automatic: candidate discarded before the main key is touched (steps 1-4).
2. Automatic rollback from in-memory `before` (step 6).
3. Normal undo: a previously exported backup file plus Restore (replace).
4. Last resort, manual: copy `buyee_item_registry_previous` into `buyee_item_registry` in the Tampermonkey
   dashboard Storage tab for this script. Mentioned in the console only, not in dialogs.
   Single slot, overwritten before every Merge, Replace, or Fix; never deleted automatically.

### Rejected alternatives

- Reject the whole file on the first invalid entry: blocks repairing a bad export by importing it.
- Automatic one-time cleanup at page load (with a marker key `buyee_item_registry_cleanup_v1`): user requires manual fix.
- Automatic backup download before each change: a broken file would leave no recovery; replaced by in-memory `before`.
- Restore keeping the merge-or-replace dialog: superseded by the separate Merge button.

### Planned tests (`tests/userscripts.test.cjs`)

- `:` IDs accepted; `,`/`=` legacy IDs fixed on import; unfixable IDs listed, skipped on OK, abort on Cancel.
- Non-string values reported as unfixable.
- Record-time: invalid ID stores nothing.
- Merge preview counts, append order, existing values kept, pending IDs kept, prune count shown, Cancel no-op.
- Replace preview counts and exact replacement (no leftover keys).
- Fix button hidden on clean data; preview counts; rewrite result; unfixable IDs kept.
- Pipeline: snapshot write failure stops; staging failure leaves main key untouched;
  main write failure rolls back to `before`; rollback failure offers in-memory download; staging key removed on success.
- Existing restore tests adapted to replace-only; then run the full suite.

## Live-Page Debugging With the VS Code Browser (verified 2026-10-26)

Use this to run the real script against the real Buyee DOM and CSS when VM tests cannot answer a question.
Tampermonkey is not installed in the integrated browser, so the script is injected by hand with stand-in grants.
It found the "late registry ID never framed" bug that the offline suite could not.

Steps (browser tools: open the page, then `run_playwright_code` with the page id):

1. Open the user-supplied item URL in the integrated browser. One load per scenario; do not browse marketplace pages otherwise.
2. Serve the script over loopback only, in an async terminal from the workspace root:
   `python -m http.server 8765 --bind 127.0.0.1 --directory .agent-tmp\userscripts`
   The Playwright sandbox has no `require` or file access, so a script tag is the only way to load a local file.
3. Wait for the DOM: `await page.waitForSelector('.recommendItem__list .recommendItem__items')`.
4. Define the grants in the page before injecting. The script is an IIFE that reads these globals:
   `window.__store = {buyee_item_registry: {}, buyee_item_registry_migrated_origins: [location.origin], buyee_item_registry_legacy_cleanup_origins: [location.origin]}`
   `GM_getValue = (k, d) => structuredClone(store[k] ?? d)`, `GM_setValue = (k, v) => { store[k] = structuredClone(v) }`, `unsafeWindow = window`.
   Optionally count `GM_setValue` calls on the registry key to assert write behavior.
5. Inject: `await page.addScriptTag({ url: 'http://127.0.0.1:8765/Cross-Market-Seen-Item-Highlighter.user.js' })`.
   The Buyee page accepted this (no CSP or mixed-content block).
6. Drive it with real scroll events: `window.scrollTo(0, y)` in steps of 500 px with a 150 ms wait, then scroll to the bottom and wait 2 s for the 1.5 s interval scan.
7. Read results with `page.evaluate`: per-card `li.style.border`, `window.__store.buyee_item_registry`, and write counts.
8. Simulate another tab by mutating `window.__store.buyee_item_registry` after injection; set up a pre-seen state by seeding the store before injection.
9. Stop the server afterwards. It serves the whole folder, including `kb/` and `clip.txt` (which contains a session token), so keep it loopback-only and short-lived.

Scenarios run: empty registry plus full scroll (all 21 cards marked and framed); IDs seeded before load (framed immediately);
IDs added after load, then scroll-past (reproduced the bug, then confirmed the fix). The page id may become invalid between calls ("Page not found"): open a new page.

Limits and pitfalls:
- Each scenario needs a fresh page load: injecting again would run two copies of the script with their own timers.
- This validates the script logic against the real DOM and CSS only. It does not cover `@match`, `@grant` sandboxing, `run-at`, or `unsafeWindow` behavior in real Tampermonkey; verify those in the user's browser.
- `history.replaceState` to another item path (to test the self-recommendation skip without a new load) hung the tool once, together with an `ERR_INTERNET_DISCONNECTED` event. Cause not established; retry or use a fresh page before drawing conclusions.
- Large page snapshots are written to a tool-result file; ignore them.
- Untried idea: serve a saved page dump from disk instead of the live site to avoid repeated marketplace loads (the page's own scripts may interfere).