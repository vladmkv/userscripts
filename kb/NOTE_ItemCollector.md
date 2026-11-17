# Item Collector: Requirements

Captured 2026-11-17 from the user; not yet refined or planned. No implementation.
Handoff and next steps: [PLAN_ItemCollector.md](PLAN_ItemCollector.md).
Background on the earlier browser-sync design: [NOTE_UserscriptsSync.md](NOTE_UserscriptsSync.md).
Existing userscripts: [NOTE_Userscripts.md](NOTE_Userscripts.md),
repository `.agent-tmp/userscripts` (https://github.com/vladmkv/userscripts).

## Reframing

The seen-ID set is part of a bigger system. The human is no longer the collector: an autonomous
collector reruns saved queries and records discovered items as database records. Downstream modules
treat those records as per-query streams and do what they need with them. This matches the feed-reader
pattern: queries are feeds, items are entries, the item ID is the entry ID, and an entry is recorded once.

Module boundary: the collector's only output is database records. Merging streams, tagging sources,
presenting items to the user, publishing, and LLM analysis are downstream modules, out of scope here.

For the collector, the old seen filter is not a separate optimization: the page is downloaded anyway,
and "is this item already in my stream" is the deduplication check itself.

## Requirements

| ID | Requirement |
| --- | --- |
| R1 | Maintain a list of queries (searches/resources) that the collector reruns from time to time. |
| R2 | Each poll sees only a small subset of a huge, growing remote database; full enumeration is impossible. |
| R3 | Each query has an ordered stream of all items that fulfilled it; the stream grows over time. |
| R4 | An item's creation time in our system is its discovery moment, not the remote listing time. |
| R5 | Discovery strategy is configurable per query and is part of the query definition. Examples: eager (grab items as soon as they appear remotely) or lazy (only items whose auction ends within 24 h; that is the discovery horizon). |
| R6 | Once an item is in a stream, ignore it forever when it reappears (refreshed or re-listed items surface as new). |
| R7 | An item matching several queries appears in each query's stream; merging happens downstream. |
| R8 | The collector's output is database records per query that downstream modules read as streams. Merging, deduplication across queries, source tags, and presentation are downstream concerns. |
| R9 | Purge is a separate, repeatable background action with its own configurable strategy. Candidates: (a) items whose state changed to sold, which requires revisiting items and is expensive; (b) items not returned by any query for a while, for example over a week, which are most likely gone or sold. |
| R10 | The collector runs autonomously, ideally in a headless browser session; its duty is rerunning queries periodically and updating the database/streams. |
| R11 | Polling load stays comparable to the user's existing manual use: these pages are reloaded at least daily anyway. User assessment: daily automated reloads do not break terms or add load. Poll frequency is bounded per query. |
| R12 | The browser highlighter's role changes: the user mainly consumes the output stream. The highlighter becomes secondary; its future use (for example showing what the user has not yet seen) is to be decided. |
| R13 | No browser consumes collector data. Syncing seen items between the user's browsers is a separate track: [PLAN_UserscriptsManualSync.md](PLAN_UserscriptsManualSync.md). The collector database can therefore live on the home server, for example SQLite. |

## Deferred (TODO)

- Discovered vs viewed state: a per-item `viewed_at` or a per-stream read position. Assume for now that the
  user consumes only the output stream.
- Whether the highlighter hides collector-discovered items during manual browsing.

## Implications for the earlier sync design

- Superseded unless planning reinstates them: encounter-recency timestamps for retention, LRU ordering,
  maximum-timestamp merging, eviction cutoffs, per-account change revisions, local journals/checkpoints,
  and the 100,000-item capacity pruning.
- Stream writes become insert-if-absent, so overlapping collector runs cannot conflict.
- Purge strategy (b) needs a per-item "last returned by a query" time, updated on every poll even though
  the stream ignores the reappearance. This is the one timestamp still clearly required.
- Browser GM storage plays no part in the collector; it stays with the separate manual-sync track.

## Decisions (2026-11-17)

| Topic | Decision |
| --- | --- |
| Purge vs reappearance | Purge items not returned for a threshold of 1-2 weeks. A purged item that reappears enters the stream again; accepted. The user tunes the threshold longer if needed. Storage must not grow endlessly. |
| Collector host | Home server, ideally headless Ubuntu. Keep it portable with minimal OS dependencies. Database authentication still to be designed. |
| Downstream modules (out of collector scope) | A small web page serves as a debug/technical viewer. The real consumer is a downstream service that publishes items to the user's own destination, such as a messenger chat. |
| Item data | Store ID plus URL, title, price, end time, and image URL, and further metadata needed for LLM analysis. |
| Downstream analysis (out of collector scope) | Items will be processed automatically: an LLM-based analyzer evaluates them and triggers actions. Exact metadata and actions to be defined. |
| Item identity | Key items by marketplace plus ID. The current highlighter (v7.33) still stores raw IDs; marketplace identity exists only as a draft plan in [PLAN_UserscriptsIdentity.md](PLAN_UserscriptsIdentity.md). |
| Query edits | The user chooses at edit time whether a parameter change keeps the existing stream or starts a new one. |
| Existing ~35,000 seen IDs | Import as already-seen, excluded from streams, so the collector never reports them as new. They are raw IDs without a marketplace, so the import needs the legacy raw-ID handling from the identity plan. |

## Design proposals discussed (not decided)

Assistant proposals from 2026-11-17, to confirm or reject when planning:

- Scan cycle per query: pick a due query with jitter and per-site rate limits; fetch result pages; parse
  cards into normalized records; insert-if-absent into the query's records and refresh "last returned"
  for known items; let the discovery strategy decide whether to fetch the next page.
- Discovery strategy as sort order plus stop condition: eager sorts newest first and stops at the first
  page containing only known items; lazy sorts by ending soonest and stops past the horizon (for example
  24 h). Other knobs: max pages per run and poll interval.
- First run of a new query: every item looks new. Needs an explicit backfill choice (record silently as
  already known, or record as discovered).
- Failure safety: a bot challenge, empty page, or parse failure must never count as "no new items".
  Mark the run failed, back off, and alert. Zero parseable cards on a normally busy query signals a
  selector break. The highlighter already detects challenge text ("just a moment", "verify you are human").
- Reuse existing parsing: the highlighter's card selectors and `getItemId()`, and the item-links script's
  `identifyItem()` (marketplace plus ID). Consider a shared site-parser module instead of duplicating it.
- Fetching: headless browser as the general path; plain HTTP or a site JSON endpoint where one exists
  (Neokyo's category selector already uses a JSON API), which is lighter and less detectable.
- Database: local on the home server (for example SQLite), since no browser consumes collector data.

## Open questions for refinement

- Database choice and location: confirm local SQLite or similar on the home server; remote access, if
  any, only for downstream modules.
- Downstream publisher and analyzer: interface between collector output and these services, and which
  metadata the analyzer needs.
- Storage forecast under the chosen purge threshold; measure actual row size.
