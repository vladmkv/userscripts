# Userscripts

Independent Tampermonkey scripts for Japanese shopping search pages.

## Install

Install Tampermonkey in Chrome, then open a raw script link:

- [Cross-Market Seen Item Highlighter](https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Market-Seen-Item-Highlighter.user.js)
- [Neokyo Yahoo Category Selector](https://raw.githubusercontent.com/vladmkv/userscripts/main/Neokyo-Category-Selector.user.js)
- [Cross-Platform Item Links](https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Platform-Item-Links.user.js)

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
a bottom-of-page scan. Buyee Mercari retains its original bottom-scan-only behavior.
Individual product/auction detail pages remain visible and unframed. Opening a
supported ZenMarket detail page still records the item. Records added in other tabs
do not change the current page's startup snapshot; reload to hide those items.

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
the background. Destination pages open only when a link is clicked. Equivalent
IDs do not guarantee a listing remains available.

## Local Checks

Requires Node.js 18 or later; no package installation is needed:

```powershell
node --test tests/userscripts.test.cjs
```

Tests exercise URL handling, metadata, and a simulated userscript DOM/storage
environment. They do not replace a Chrome/Tampermonkey end-to-end check.