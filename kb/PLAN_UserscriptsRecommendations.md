# Buyee item-page recommendation framing

Companion: [NOTE_Userscripts.md](NOTE_Userscripts.md).
Separate, deferred work: [PLAN_UserscriptsSync.md](PLAN_UserscriptsSync.md).
Date: 2026-10-26. Status: original framing implementation and offline validation complete; publish and the follow-on scroll-to-mark behavior remain pending.
Repository: `.agent-tmp/userscripts`, relative to the workspace root.
Paths below are repository-relative unless otherwise stated.

## Follow-on Change Draft (2026-10-26, not implemented)

### Request and clarified scope

This behavior change is Buyee-only. On Buyee item-detail pages, mark recommendation cards as seen when the user has scrolled past them, using the existing shared registry and visual frame. Scope is the existing recommendation lists selected by `.recommendItem__list .recommendItem__items`. Do not change handling of the currently opened item or item-page behavior on ZenMarket, Neokyo, or other sites. On Buyee search pages, the only related change is removing the Mercari exception that delays marking until the bottom sweep; keep all other search behavior unchanged.

The user chose mark-and-paint only: recommendation cards remain visible on item pages, including cards already seen before page load. Do not apply the search page's hide-on-later-visit behavior to detail-page recommendations. Existing seen-at-page-load cards remain outlined; newly passed unseen cards are recorded and outlined.

Why distinguish previously seen from unseen IDs: previously seen cards need only be painted; they should not be queued for another storage write. A newly passed unseen card must be added to the shared registry once, then painted on subsequent scans. This avoids needless writes while keeping repeated 1,500 ms scans idempotent.

### Proposed implementation

- Extend `processBuyeeItemRecommendations()` to mark unseen cards when fully above the viewport or during the bottom sweep. Apply to all recommendation marketplaces on Buyee item pages, including Mercari. Paint cards already in the registry without marking them again. Reuse `getBuyeeRecommendationItemId`, `markSeen`, `pendingWrites`, `flushPendingWrites`, `seenThisVisit`, and `paintSeenItem`; repeated scans should not enqueue duplicate writes.
- Keep the detail-page path separate from the search listing loop so recommendations are never hidden and search-only panel, title alarm, and auto-reload behavior remains inactive on item pages. Leave the current Buyee item unrecorded. Preserve ZenMarket's existing immediate marking of its opened item.
- In the Buyee search loop, remove only the Mercari exception that prevents above-viewport marking. Mercari search items should mark when fully scrolled past, like other supported search cards; retain bottom-sweep behavior.
- Continue using the existing 300 ms / 800 ms startup scans, scroll handler and 1,500 ms interval to cover lazy-loaded cards. Keep legacy localStorage cleanup behavior unchanged.

### Validation plan

- For each supported Buyee item route and recommendation card type, an unseen card below the viewport stays unrecorded; after scrolling it past the viewport, it is added once to the shared registry, outlined red, and remains visible.
- A bottom-of-page sweep records the visible recommendation cards, matching search behavior.
- Cards already seen at page load are outlined but remain visible; repeated scans do not duplicate writes or events; delayed cards are processed when inserted.
- Replace `Buyee Mercari still requires a bottom sweep to mark unseen cards` with a test that proves an unseen Mercari search item is marked after it scrolls fully above the viewport; keep a separate bottom-sweep test.
- Preserve existing link parsing coverage (relative/absolute URLs, query parameters, multiple anchors, invalid/watch links), other search-page behavior, and ZenMarket opened-item marking. Ensure no new panel/alarm/reload behavior is activated on item pages.
- Run `node --test --test-reporter=dot .agent-tmp\userscripts\tests\userscripts.test.cjs`; report browser/Tampermonkey verification separately.

This draft supersedes the original "recommendations ... never become seen" decision only for the item-page recommendation path after implementation; all other scope exclusions remain. The plan is now behaviorally specified but still not implemented.

## Original Feature Record (Historical)

The following section records the completed v7.25 display-only implementation. Its original rules that recommendations never become seen and that search behavior remains unchanged describe that release, not the follow-on draft above. The follow-on supersedes those two rules only for Buyee recommendation cards and the Mercari search scroll-past workaround; all other original scope exclusions remain.

## Tasks

### Objective and scope

Show the existing red seen-item frame on already-seen recommendation cards on
Buyee item pages. Recommendations remain visible and never become seen merely
because the user opens the page, scrolls, or reaches its bottom.

Confirmed coverage from the user's pasted HTML:
- Fleamarket "You may also like" cards linking to `/paypayfleamarket/item/<id>`.
- Mercari "You may also like" cards linking to `/mercari/item/<id>`.
- Mercari seller's other items, using the same recommendation classes.
- JDirect auction `#categoryHotProducts` recommendations linking to
  `/item/jdirectitems/auction/<id>`, including mixed Fleamarket cards.

All supplied lists use `.recommendItem__list .recommendItem__items`.
Do not depend on heading text, analytics attributes, or whether the outer
container is an `aside` or `section`. Other layouts are not verified.

### Behavior and implementation decisions

- Reuse `paintSeenItem(card)`: `4px dashed #e74c3c` and background `#fdf2f2`.
  Paint the recommendation `li`, not the whole list or the gamma controls.
- Check `seenAtPageLoad`, preserving existing display stability: entries added
  by another tab after startup take effect after reload, not mid-visit.
- Find an actual supported item link inside each card. Skip watch-list buttons
  without `href`, empty anchors, and unrelated links. Resolve relative URLs
  against `location.href` before reusing `getItemId()`.
- Preserve raw ID case and spelling, including numeric-only auction IDs.
  Query parameters such as `conversionType` are not part of the ID.
- Multiple image/title links for one card must produce only one card frame.
  Descendant lookup must work with and without the existing `.g-wrap` wrapper.
- Add a Buyee item-page-only processing path before the search-only return in
  `processStateEngine()`. Do not feed recommendations through search marking
  or hiding logic.
- Reuse initial, scroll, and 1,500 ms scans for delayed cards. No new observer,
  dependency, network request, storage format, or storage key is needed.
- Never call `markSeen()`, `hideSeenItem()`, or `flushPendingWrites()` from the
  new recommendation path; never dispatch `buyeeItemSeen` there.
- Leave the main Buyee item unchanged and unrecorded, matching current behavior.
  Preserve ZenMarket's existing main-item recording, as the user selected.
- Keep search behavior, search panel, title alarm, and auto-reload unchanged;
  those search features must not activate on Buyee item pages.
- Fix the Mercari metadata match to `*://*.buyee.jp/mercari/item/*`.
- Preserve the userscript name, namespace, grants, registry, and update URLs.
  Increment version 7.24 to 7.25 if still current when implementing.

### Working tasks

1. [DONE] Inspect the owning highlighter functions and neighboring VM tests;
   confirm Buyee-only scope and retain ZenMarket main-item recording.
   Outcome: existing painter, ID parser, and scan scheduling are reusable.
2. [DONE] Inspect the user's supplied Fleamarket, Mercari recommendation/seller,
   and JDirect HTML. Outcome: one shared card selector covers all supplied lists;
   JDirect needs href-filtered descendant lookup and relative URL handling.
3. [DONE] Implemented an isolated Buyee item-page recommendation display path in
  `Cross-Market-Seen-Item-Highlighter.user.js`, corrected Mercari metadata to
  `*://*.buyee.jp/mercari/item/*`, and bumped version from 7.24 to 7.25.
  Outcome: recommendation cards frame if and only if their ID is in
  `seenAtPageLoad`; no recommendation path writes, hides, or seen events.
4. [DONE] Extended `tests/userscripts.test.cjs` with minimal harness additions
  for recommendation-card anchor selection, multi-card scans, delayed insertion,
  and event/write tracking on Buyee detail pages.
  Outcome: coverage now includes all three Buyee detail routes, mixed-card lists,
  absolute+relative URLs, conversion query handling, invalid/empty/missing links,
  and reload-only behavior for late cross-tab updates.
5. [DONE] Validated full offline suite and inspected scope.
  Outcome: `node --test --test-reporter=dot .agent-tmp\userscripts\tests\userscripts.test.cjs`
  passed with 54/54 tests; no failures. Browser-installed Tampermonkey behavior
  remains a separate manual verification gate before publish. **high**
6. [TODO] After separate publishing approval, commit/push the tested change
   and verify the existing Tampermonkey entry on an authorized example page.
   Do not claim local tests prove installed-browser behavior. **future**

### Validation gate

Tests must cover:
- Seen and unseen cards across all four supplied list layouts and all three
  Buyee item-page routes, with multiple lists present together.
- Absolute and relative URLs, conversion query parameters, numeric and prefixed
  auction IDs, and JDirect cross-market Fleamarket recommendations.
- Watch-list anchors and empty anchors before the real item link; duplicate
  image/title links; cards with and without `.g-wrap`; missing/invalid links.
- Delayed cards and repeated scans, plus scrolling above the viewport and
  bottom-of-page sweeps: known cards frame, unseen cards stay unchanged.
- No registry writes or seen events from recommendations, no hidden cards,
  no main-item recording on Buyee, no panel/title alarm/auto-reload on details.
  Existing one-time Buyee legacy cleanup is separate and remains unchanged;
  preseed its completed markers when asserting zero total GM writes.
- IDs introduced by another tab after page load remain unframed until reload.
- Existing search behavior and ZenMarket main-item recording still pass.
- Metadata contains the corrected Mercari wildcard and retains script identity.

Run from the workspace root, keeping full output in a unique run directory:

```powershell
node --test --test-reporter=dot .agent-tmp\userscripts\tests\userscripts.test.cjs
```

Stop when the offline suite passes and the scoped diff contains only the
highlighter and its existing test file, with any live-browser gaps disclosed.
No sync implementation, other userscript edits, Git writes, or publishing are
authorized by this draft.

## Devlog

### 2026-10-26 - Detail pages bypass recommendation styling

The existing state engine returns on Buyee detail pages before selecting cards;
using the search loop would also introduce unwanted seen-state writes and hiding.
Plan a separate display-only path using the existing painter and page-load seen
snapshot. The supplied JDirect DOM also contains href-less watch/empty anchors
before the actual links, so selecting the first arbitrary anchor is insufficient.

### 2026-10-26 - Consolidated userscripts documentation

At the user's request, moved `NOTE_Userscripts.md`, `NOTE_UserscriptsSync.md`, and
`PLAN_UserscriptsSync.md` from the workspace root into
`.agent-tmp/userscripts/kb/` without changing their contents. Their mutual
relative links are preserved. Added this separate feature plan; no userscript
source or test changes have been made for this task.
The user selected `userscripts/kb` as the final location; `/kb/` is excluded
locally through `.git/info/exclude`, without changing tracked ignore rules.

### 2026-10-26 - Buyee detail recommendation framing implemented and verified

Implemented the Buyee detail-page recommendation-only styling path and kept it
strictly display-only. The search pipeline remains unchanged, and detail pages
still avoid search-only side effects (seen writes, hiding, panel, alarm, reload,
and seen events). Updated metadata for Buyee Mercari item wildcard matching and
bumped script version to 7.25. Full offline suite now passes (54/54).

### 2026-10-26 - Unpainted recommendation cards: IDs saved by another tab after load

Reproduced in the live Buyee item page with the script injected and in-page
GM_* stand-ins: an ID added to storage after page load (e.g. by a search tab)
was neither in `seenAtPageLoad` nor `seenThisVisit`, so the old
`itemRegistry[itemId] === 'hide'` early return skipped it and it was never
framed. Fix: on Buyee detail pages, paint any card whose ID is in
`itemRegistry` (no write, no event). The snapshot restriction only protects
hiding on search pages and is unnecessary where nothing is hidden. The test
"do not react to late shared-storage updates until reload" was replaced by
one asserting the card is framed without writes or events.

Explicitly ignored for now: an ID disappearing from storage mid-visit (the
only case where `seenAtPageLoad` / `seenThisVisit` differ from `itemRegistry`
on detail pages, e.g. retention pruning or a replace-restore). Behavior at the
60,000-entry cap has never been tested and nothing is cleaned live, so no
speculative handling is added; the risky spots are tagged `REVIEW(pruning)` in
the script for review when pruning is implemented (all tabs would then reload).
Possible later simplification: the detail-page condition could use
`itemRegistry[itemId] === 'hide'` alone.