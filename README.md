# Userscripts

Independent Tampermonkey scripts for Japanese shopping pages and Google AI Mode.

## Current Status

Source inspected on 2026-11-03. This README is the general development handoff;
implemented behavior below is separate from the remaining-work list.

| Script | Local version | Status |
| --- | --- | --- |
| Cross-Market Seen Item Highlighter | 7.29 | Local seen tracking, recommendation framing/marking, reload countdown and search-title alarm |
| Neokyo Yahoo Category Selector | 1.3 | Cascading categories, optional lock, persistent cache and rate-limit cooldown |
| Cross-Platform Item Links | 1.12 | Platform links plus Buyee price/deadline monitoring, countdowns and closing-title alerts |
| Google AI Mode - Lightweight History | 0.2.0 | Experimental CSS workaround and opt-in answer hiding; performance improvement not yet measured |

The user observed successful live auction price/deadline checks, but also reported
repeated `Current price missing or invalid in response` failures. Those failures
remain unresolved. Fast randomized failure retries and console error logging have
been requested but are not implemented in the inspected source.
Local source versions do not establish the installed Tampermonkey version or
GitHub publishing state; verify those independently before rollout.

## Install

Install Tampermonkey in Chrome, then open a raw script link:

- [Cross-Market Seen Item Highlighter](https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Market-Seen-Item-Highlighter.user.js)
- [Neokyo Yahoo Category Selector](https://raw.githubusercontent.com/vladmkv/userscripts/main/Neokyo-Category-Selector.user.js)
- [Cross-Platform Item Links](https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Platform-Item-Links.user.js)
- [Google AI Mode - Lightweight History](https://raw.githubusercontent.com/vladmkv/userscripts/main/Google-AI-Mode-Lightweight.user.js)

If the highlighter is already installed, update that existing Tampermonkey entry
rather than deleting it or creating a second copy. Its name and namespace are
unchanged to preserve the existing script identity and stored registry. Back up
Tampermonkey data before changing an installation that contains valuable history.

Tampermonkey periodically checks the update URL. Published changes must increment
the script's `@version`. Reload site tabs after installing an update. These
user-owned scripts are not affiliated with the supported websites.

## Seen Item Highlighter

Uses one Tampermonkey registry across Buyee, ZenMarket and Neokyo. Search cards
whose IDs were already stored when the page loaded are hidden. Items newly seen
during the current visit receive a pale red background and dashed red frame, but
remain visible until reload. After reload, those saved items are hidden too. Grid
wrappers are hidden along with cards where supported.

Newly seen items are saved in one batch per scan. The batch is merged with the
latest stored registry, then read back to confirm every item was saved. Items that
fail confirmation stay pending and are retried with backoff (5 s doubling to 60 s).

Search pages show a lower-left panel with the stored item count, the number of
items hidden on the current page, any unsaved items, a "Show hidden items" toggle,
"Back up data", "Restore data" and a button that moves the panel between the
lower-left and lower-right corners; the chosen side is remembered. The toggle only
changes the current page and resets on reload. The backup downloads a JSON file
containing the registry and migration markers. Restore accepts only such files and
asks each time whether to merge the backup into the stored items or replace them.
Restored items are hidden after the next reload.

Search items are recorded when their cards leave the viewport above it, or during
a bottom-of-page scan, including Buyee Mercari. The opened detail page remains
visible; opening a supported ZenMarket detail page still records its item.
On Buyee detail pages, recommendation cards in
`.recommendItem__list .recommendItem__items` are framed if seen, never hidden.
Unseen recommendations become seen when scrolled fully above the viewport or
during a bottom sweep; the currently opened Buyee item is not newly marked by this path.
On search pages, records added in other tabs do not change the current page's
startup snapshot; reload to hide those items. Buyee recommendations can be framed
from the latest shared registry during subsequent scans.

Search pages reload after a random 5-10 minutes. The panel counts down to that
reload; recent scrolling (within 30 seconds) or unsaved marks postpone it by one
minute. While unseen search cards remain, the tab title alternates red/blue circle
markers with their count. Detail recommendations do not start these search-only
reload/title features.

The shared registry uses Tampermonkey storage. For origins marked as migrated,
the updated highlighter removes the obsolete `buyee_item_registry` localStorage
copy once and preserves the shared registry. If an origin has no migration marker,
its legacy localStorage is left untouched. Raw item IDs are retained for
compatibility, so unrelated marketplaces with colliding IDs cannot be
distinguished. Concurrent tab writes are not transactional. The registry retains
up to 60,000 seen records under normal operation.

Current Neokyo searches: Yahoo Auction, Mercari, Yahoo Flea Market. Selectors depend
on site markup and may need maintenance. Matching a userscript URL alone does not
guarantee every page layout is supported. No browser history or registry export is
stored in this repository.

## Neokyo Category Selector

Adds cascading Yahoo Auction category dropdowns, initially set to portable cassette
players with the category lock off. Category choices come from Neokyo's category
API and are cached in Tampermonkey storage for 30 days, avoiding repeat requests
on reload. HTTP 429 responses honor `Retry-After` (15-minute cooldown if absent);
stale cached categories remain available during cooldown. Use Apply category to
navigate while preserving other URL filters and returning to page 1.

Lock category retains the selected category across search forms, pagination links,
and subsequent page loads. Pagination is preserved when correcting dropped
categories. All categories clears the category restriction and disables the lock.
The selector is limited to Neokyo's English Yahoo Auction search, not Mercari or
Yahoo Flea Market, and remains separate from seen-item tracking.

## Cross-Platform Item Links

A separate lower-left panel with vertically stacked platform buttons opens the same item
on Buyee, ZenMarket or Neokyo in a new tab. Its move button switches it between the
lower-left and lower-right corners; Tampermonkey storage remembers only that side. The marketplace is derived from the
URL path or explicit shop parameter, never from the ID prefix. Item IDs retain
their original case and characters; conversion and search-tracking parameters
are not copied to destination links.

JDirectItems Auction and Mercari support all three platforms. JDirectItems Flea
Market uses the user-specified ZenMarket route assumption
`product.aspx?shop=yahooFleaMarket&itemCode=<id>`; this route has not been
live-verified. ZenMarket Shopping (`shop=yshopping`) is not treated as Flea Market.
The panel does not read or change the highlighter registry. Each button uses its
destination site's native favicon URL; the browser uses its cache when available
and may request an icon on a cache miss. No item or search pages are requested in
the background on ZenMarket or Neokyo. Buyee closing-time pages have the background
monitor described below. Destination links open only when clicked. Equivalent IDs
do not guarantee a listing remains available.

### Buyee Auction Monitoring

The panel shows the closing time converted from JST to `Europe/Helsinki`, the
remaining time, current price in YEN, last successful check, and time until the
next check. Helsinki automatically switches between EET and EEST. The next-check
display omits unused day/hour fields: `00:01`, `02:15:00`, `01:03:00:00`.

No background request is made while more than ten minutes remain. The panel uses
the loaded page values and schedules the first check for the ten-minute window.
After an extension beyond that window, checks pause again using the updated deadline.

| Time remaining | Random delay after a successful check |
| --- | --- |
| More than ten minutes | Wait until ten minutes remain; no polling |
| Ten to five minutes | 30-60 seconds |
| Five to two minutes | 15-30 seconds |
| Two minutes or less | 7.5-15 seconds |

Checks do not overlap. During normal successful monitoring, the next check is
scheduled no later than the closing boundary. At/past the deadline, a successful
final check with a future deadline continues monitoring. If it confirms a deadline
that is still past, the script clears its check/countdown/title timers, restores
the original title, and reloads the page to show the final site status. A request
started before closing cannot itself confirm that final state; another check is
made. A page already showing a past deadline on initialization stays stopped and
does not enter a reload loop. Failed checks never establish that the auction ended.

An orange circle blinks in the title with 15 minutes or less remaining. At five
minutes it becomes red, with each blink phase shortening from about 1,000 ms to
200 ms as closing approaches. Alerts stop at the deadline or when an extension
moves the deadline outside the alert window.

### Implementation Map

- `identifyItem()` / `destinationLinks()`: validate item identity and construct platform URLs.
- `parseClosingTime()`: parse `29 Oct 2026 21:52:00` as JST (UTC+9), rejecting invalid dates.
- `readAuctionDetails()`: find the `.itemDetail__list` labeled `Closing Time (JST)`;
	extract price from `.current_price .price`, currently requiring leading digits/commas followed by `YEN`.
- `startClosingCountdown()`: owns the display, latest fetched details, polling, deadline confirmation and title alert.
- `scheduleCheck()` / `checkAuction()`: recursive timeouts, ten-minute gate and a same-tab in-flight guard.
- Transport: same-page `fetch` with same-origin credentials, `cache: 'no-store'`,
	`redirect: 'error'`, and a 20-second AbortController timeout. DOMParser parses
	returned HTML; it is not inserted into the live page and its scripts are not executed.
- A response is accepted only if both closing time and price parse successfully.
	Recognized security/login titles and non-success HTTP responses are rejected.
	Last good data is retained after a failed check; original page values do not
	overwrite a successful remote update.
- Current error behavior: detailed panel message, but no console logging or retained
	response diagnostics. Failure delay starts at 30-45 seconds and grows to a
	300-450-second range, honoring longer `Retry-After` values. This does not yet
	satisfy the requested ordinary 5-10-second retry behavior.
- GM storage remains limited to `item_links_panel_side`; auction observations and
	timers are page-local. There is no cloud synchronization in these scripts.

### Remaining Auction Work

These are planned changes, not implemented behavior. Final-state policy below is
selected; the retry policy is a recommendation awaiting confirmation. Do not mark
the retry implementation ready before that choice is confirmed.

1. [TODO] **high** Add bounded, privacy-conscious error logging for diagnosis.
	 Record check time, stage, HTTP status, final response URL, page title, selector
	 presence and a short price-field excerpt, plus the error. Avoid cookies,
	 credentials, full response HTML and unrelated page content. Panel errors alone
	 currently discard evidence needed to investigate recurring failures.
2. [TODO] **high** Diagnose and fix recurring missing-price errors using the actual
	failing markup. The local-only saved page showed `500 YEN` under `.current_price .price`,
	but it does not prove every response uses that layout/currency text. Distinguish
	 missing selector, changed formatting, ended-auction markup, login/challenge and
	request failures. Keep the raw page local; preserve only sanitized relevant markup
	as a tracked test fixture when a failing example is available. Do not guess broader
	selectors or treat failures as proof of blocking. Apply the selected final-state
	rule below rather than making a missing final price block closure indefinitely.
3. [TODO] **high** Change ordinary failed-check retries to a fresh random 5-10 seconds,
	as requested, after confirming the failure classes below. Add a manual Retry check
	action if the recommended pause-on-access-failure policy is selected. Extend tests
	for every class and for failed final checks; preserve server `Retry-After`.
4. [TODO] **medium** Replace the current orange/red title thresholds with green at
	15 minutes remaining, yellow at five minutes, and red at two minutes. Keep red
	blinking faster toward zero. Put threshold times, colors and blink timing in
	clearly named, easily editable constants at the beginning of the item-links script.
	Test exact boundaries, extensions and timer cleanup; do not change the separate
	highlighter's search-title alarm.
5. [TODO] **medium** Validate the final-check/reload lifecycle, title blink thresholds,
	 next-check countdown and price parsing in actual Chrome/Tampermonkey. Offline
	 mocks cover these paths but do not prove site markup, background-tab scheduling,
	 authentication, or browser restrictions.

### Failure Policy to Confirm

Recommended policy: fast retries for potentially transient failures; pause when
access requires user intervention. This recommendation has not been selected yet.

| Failure | Recommended behavior |
| --- | --- |
| Network failure or 20-second timeout | Retry after a fresh random 5-10 seconds |
| HTTP 5xx | Retry after a fresh random 5-10 seconds; honor a longer Retry-After |
| Missing/invalid fields or parsing failure before confirmed closure | Log bounded diagnostics; retry after a fresh random 5-10 seconds |
| HTTP 429 | Honor Retry-After; without it, use increasing backoff rather than 5-10-second polling |
| Security challenge or login page | Pause automatic requests, retain last good data, expose manual retry after access is resolved |
| Other HTTP 4xx | Pause automatic requests and show/log the status for investigation |

Existing tests expect a 30-second first retry for a challenge and a failed final
check, and honor a 429 Retry-After. Those assertions describe current behavior,
not the requested policy. Update them only after the policy is agreed.

Selected final-state rule: a successful post-deadline check with a valid closing
time still in the past is sufficient to stop timers and reload, even if price is
absent. Recognized login/challenge pages and non-success HTTP responses still do
not confirm closure. A future deadline continues monitoring; if its price is
missing, keep the last good price and report that it is stale rather than discard
the valid extension. This missing-price handling is planned, not implemented.

### Reproducible Markup

The raw saved page is excluded from Git and must remain local. This sanitized
known-good fragment documents the selectors without personal page data; it is not
a reproduction of the reported failing response:

```html
<dl class="current_price">
  <dt>Current Price</dt>
  <dd><div class="price">500 YEN <span class="price-tax">(Tax 0 yen)</span></div></dd>
</dl>
<li class="itemDetail__list">
  <div class="itemDetail__listName">Closing Time (JST)</div>
  <div class="itemDetail__listValue">29 Oct 2026 21:52:00</div>
</li>
```

Capture a sanitized failing fragment before proposing a format-specific fix.
The current auction VM tests supply parsed-document mocks, not real HTML parsing;
a future tracked fixture should exercise actual extraction without live traffic.

The older two-minute post-deadline grace window is superseded by successful final
verification and one reload. Do not restore the old stop-without-confirmation logic.

## Item Annotation TODO

1. [TODO] **medium** Add optional annotations to selected items. Start with an editable
	text value, but store an object such as `{ "text": "Check condition before bidding" }`
	per item so future structured fields do not require replacing a string-only format.
	Before implementation, agree which script owns the data, where annotations are
	edited/displayed, identity rules, backup/restore inclusion and deletion behavior.
	Keep annotation data separate from the `"hide"` registry values and avoid claiming
	cross-script or cross-computer sharing without an explicit storage/bridge design.

## Google AI Mode - Lightweight History

Experimental workaround for rendering-related lag in long Google Search AI Mode
conversations on `www.google.com/search`. Keeps the latest three recognized answer
containers visible and hides older answers with CSS. Questions are unchanged;
message content is not deleted or sent elsewhere. No conversation data is stored.

Version 0.1.1 worsened typing latency in the recorded comparison. Version 0.2.0
targets a measured cause instead. In a Chrome CSS selector-statistics trace, Google's
selector `:has(.WTfRgd, .zlmqU):has(.B5aSS) :is(.Y3BBE, .n6owBd)` took 65% of
selector-matching time during typing and matched no elements. The script removes
only that selector from Google's stylesheets on load, rechecking every three seconds
for newly added stylesheets. Turn CSS fix off restores the original rule. The typing
improvement has not yet been measured.

Answer hiding starts paused on every reload, with no
automatic scan, mutation observation, or hiding. Use the script's Tampermonkey
menu to enable hiding explicitly. Restore all answers disconnects its observer
and removes its hiding classes. Hidden answers are unavailable to normal page
search and accessibility navigation until restored. Selectors depend on Google's
current markup.

For diagnosis, record in Chrome Performance while paused, type a short unsent
draft, select Keep latest 3 answers (resume), then type again. Restore all answers
if the delay worsens. The timeline includes `AIMLH scan`, `AIMLH apply hiding`,
`AIMLH observer`, and `AIMLH restore all` User Timing measurements. They measure
the script operations, not all subsequent browser rendering work.

Show lightweight history status logs matched/recognized/hidden answer counts and
cumulative scan, mutation, and class-change counters with the console prefix
`[AI Mode Lightweight]`. Automatic update summaries are limited to once every
five seconds; no chat text or individual keystrokes are logged. Reset diagnostic
counters starts a fresh counting interval. Save the Performance recording and
retain the console snapshots for comparison.

## Local Checks

Use a current Node.js release; no package installation is needed:

```powershell
node --test tests/*.test.cjs
```

Tests exercise URL handling, metadata, and a simulated userscript DOM/storage
environment. They do not replace a Chrome/Tampermonkey end-to-end check.

For PowerShell, the full suite can also be run explicitly without relying on glob expansion:

```powershell
node --test --test-reporter=dot tests/userscripts.test.cjs tests/google-ai-mode.test.cjs
```

`tests/userscripts.test.cjs` reuses `scan`, `fakeElement`, category API mocks and
`auctionMonitor`. The auction harness captures timers, requests and reloads and
supplies parsed-page fixtures without real Buyee traffic. Tests cover JST/EET/EEST,
random delay boundaries, extensions, next-check formatting, last-good data,
failure diagnostics, final checks, timer cleanup and escalating title alerts.
`tests/google-ai-mode.test.cjs` checks the experimental helper separately.
Verification on 2026-11-03: both offline suites passed with the explicit command
above. No live website requests or new Chrome/Tampermonkey validation were performed
for this documentation update.

## Development Handoff

Continue with the remaining auction work above; this README update itself changes
no behavior. Read the current source and nearby tests before editing. The local
knowledge folder and raw saved page are excluded from Git; they are optional local
background, not prerequisites available to a fresh clone. This README must remain
self-contained for the current scripts and outstanding work.

Supabase synchronization is separate, unimplemented work: the working direction
is per-record maximum-encounter-time merging plus server change tracking,
independent device sessions, bounded retention, and automatic checks with visible
results. Detailed local plans are not shipped here and must not be treated as
approved implementation scope. Before starting sync, obtain the user's current
decisions and agree durable pending uploads, cursor/data persistence, authentication,
retention and migration. Do not silently add a journal architecture or provision
cloud resources. Item annotations are another distinct feature, not part of the
current auction-monitoring fixes.

Keep each script independent, reuse the existing harness, and avoid unrelated
cleanup or a new framework. Do not open marketplace pages or issue live probes
without the user's authorization. Preserve installed script identity and valuable
GM data; keep secrets and personal exports out of Git. Run the full relevant suite
and report simulated versus live validation separately. Bump the touched script's
version for release, obtain separate commit/push approval, then verify the version
actually served by GitHub and installed in Tampermonkey before investigating an
apparent old-version failure. Manual user actions are not cost-free.