# Seen-Item Marketplace Identity Plan

Companion: [NOTE_Userscripts.md](NOTE_Userscripts.md).
Separate work: [PLAN_UserscriptsSync.md](PLAN_UserscriptsSync.md).
Date: 2026-11-09. Status: draft for discussion; no source changes authorized.
Repository: `.agent-tmp/userscripts`, relative to the workspace root.

## Objective

Distinguish listings from different underlying marketplaces while preserving tracking of the same listing across Buyee, Neokyo, and ZenMarket. A collision is possible under the current raw-ID scheme; an actual collision has not been demonstrated.

## Decisions

- Confirmed: use underlying marketplace identity, not proxy-site identity. A registry per proxy would break cross-proxy tracking.
- Confirmed: use explicit route/shop aliases to map different proxy names to the same marketplace, following the existing item-links script. Store the marketplace, not the proxy; add mappings only when their equivalence is established.
- When a new shop is encountered, prompt the user to confirm it. If approved, add it to the local registry as a marketplace and track its items there. This supersedes deferring new shops; do not add an assertion.
- Handling existing raw IDs is a separate TODO. The earlier indefinite-fallback choice is not locked as the migration policy; decide the approach separately before implementation.
- Retain the current eBay behavior and its `ebay_<id>` history; that prefix was not reserved, so old matching raw IDs can be ambiguous.
- Plan only. Source edits, installation, Git writes, and publishing require separate approval.

## Proposed Design

Use one versioned registry containing distinct marketplace namespaces, for example `yahoo`, `mercari`, `flea`, and `ebay`, plus a separate legacy raw-ID collection. For example, `mercari` / `123` and `yahoo` / `123` are different records, while the same Mercari ID reached through two proxies is one record. Names and exact serialized layout remain implementation decisions; separate storage keys per marketplace are not necessary for isolation.

Determine the marketplace from the listing URL, not ID shape: Buyee item routes, Neokyo product routes, and ZenMarket auction route and product `shop` parameter have precedents in `Cross-Platform-Item-Links.user.js`. eBay uses its listing URL. Buyee recommendations must classify each card independently because one list can contain mixed marketplaces.

When a URL exposes a previously unknown shop, present its name for user confirmation. On approval, persist the shop as a new marketplace in the local registry and track its items under that marketplace. Do not silently treat it as an alias of an existing marketplace; equivalence requires separate evidence. Exact prompt, rejection behavior, name validation, and cross-tab handling remain to be designed.

### Route Evidence (2026-11-09)

| Source | URL evidence | Proposed marketplace | Evidence and limits |
| --- | --- | --- | --- |
| Buyee | `/item/jdirectitems/auction/<id>` | Yahoo auction | Item-links classifier and tests; recommendation fixtures include mixed markets. |
| Buyee | `/mercari/item/<id>` | Mercari | Item-links classifier and tests. |
| Buyee | `/paypayfleamarket/item/<id>` | Flea Market | Item-links classifier and tests. |
| Neokyo | `/en/product/yahoo/<id>`, `/mercari/<id>`, `/yahooFleaMarket/<id>` | Yahoo auction, Mercari, Flea Market respectively | Item-links classifier and tests use the full `/en/product/` path for each. |
| ZenMarket | `/auction.aspx?itemCode=<id>` | Yahoo auction | Item-links classifier, tests, and a user-supplied real URL. |
| ZenMarket | `/product.aspx?shop=mercari&itemCode=<id>` | Mercari | Item-links classifier, tests, and a user-supplied real URL. |
| ZenMarket | `/product.aspx?shop=yahooFleaMarket&itemCode=<id>` | Flea Market | User-specified route assumption in item-links tests; not live-verified. |
| ZenMarket | `/product.aspx?shop=yshopping&itemCode=<id>` | Candidate new marketplace | Item-links tests reject it as a cross-platform link; highlighter generically accepts its `itemCode` without storing the shop. Under the proposed design, prompt before adding an unknown shop. |
| ZenMarket | `/product.aspx?itemCode=<id>` without `shop` | Invalid | User confirms the product page fails without `shop`; synthetic highlighter fixtures currently accept it, whereas the item-links classifier rejects it. |
| eBay | `/itm/<numeric-id>` or `/itm/<slug>/<numeric-id>` | eBay | Highlighter tests cover both; 60 result links matched the numeric form on the supplied live search page. |

The existing item-links classifier rejects colon-bearing IDs, whereas the highlighter intentionally accepts them for ZenMarket. It is a route precedent, not a drop-in replacement. The 14 existing route and recommendation tests passed on 2026-11-09; they validate code and fixtures, not the live ZenMarket page markup. No cached ZenMarket HTML with representative item links was found in the inspected run artifacts.

On a new observation, write the marketplace-qualified entry. Keep existing values and `hide` semantics intact. Do not assign a marketplace to a legacy ID merely because it looks like one; lost provenance cannot be reconstructed reliably. Handling existing IDs, including eBay-prefixed IDs whose origin is not provable from the prefix alone, remains to be decided separately.

An active legacy fallback would still hide an unrelated item when its raw ID matches an old record; new qualified records alone would not eliminate that risk. Retention and old eBay prefixes require explicit treatment before implementation.

## Open Decisions and Evidence

- The user supplied distinct real URL forms for ZenMarket Mercari and Yahoo auctions; the item-links classifier already distinguishes both. The user confirms product URLs without `shop` fail, so those synthetic fixtures do not establish supported listings and are not a migration blocker. The existing highlighter's generic raw-ID acceptance does not establish marketplace support for Yahoo Shopping or other new shops.
- Specify how a new-shop prompt is presented and deduplicated, how approval and rejection affect the current item and future prompts, how untrusted shop names are validated, and how simultaneous tabs and backup/restore preserve approved shops.
- Decide how to apply the existing 60,000-entry limit across qualified and legacy records and what counts in the panel. Separate collections lose the current single-object enumeration order, so do not claim exact preservation without a tested policy.
- Decide how eBay's old `ebay_<id>` entries interact with raw IDs from other markets; provenance is not recoverable in the ambiguous case.
- The planned sync contract currently assumes raw IDs. Reconcile its identity and backup assumptions in a later agreed sync planning phase; do not implement cloud sync here.

## Working Tasks

1. [TODO] **high** Route and mixed-recommendation precedents checked in local fixtures (14 tests pass); user-supplied URLs confirm the ZenMarket Mercari and Yahoo auction forms. User confirms product URLs without `shop` fail; update the synthetic tests accordingly. Cover supported marketplaces and design confirmation and persistence for newly encountered shops.
2. [TODO] **high** Decide the separate old-ID handling approach, including whether any fallback is used and its collision tradeoff. Specify the versioned registry, capacity, panel counts, eBay legacy handling, startup behavior, and preservation of existing `buyeeItemSeen` consumers. Document compatibility limits for concurrently open old-version tabs.
3. [TODO] **high** Design non-destructive initialization: retain the original registry for rollback, verify the new representation before use, preserve legacy values and pending IDs, and do not infer missing marketplace provenance. Handle interrupted writes and distinguish local read-back verification from disk durability.
4. [TODO] **high** Design backups and restores for both legacy and new data. Use a distinct new format identifier so old code, whose parser does not check the backup version, rejects it instead of treating a new-format file as an old registry. Specify legacy import, merge, replace, rollback, and pruning without losing either collection.
5. [TODO] **high** After the design is confirmed, update the existing highlighter and tests, increment the userscript version, and preserve the existing script name, namespace, grants, other-site behavior, panel features, and eBay refresh setting.
6. [TODO] **high** Extend the existing offline suite: identical IDs in distinct qualified marketplaces, same listing across proxies, the chosen old-ID behavior and its collision risks, ambiguous eBay prefixes, new-shop confirmation, acceptance and rejection, persistence and repeat scans, mixed recommendations, search and detail pages, delayed cards, reload stability, backups, restore failures, retention, and old-version compatibility. Run the entire userscript suite and report any pre-existing failures separately.
7. [TODO] **high** Blocker for task 5: lock the old-ID policy, at least an interim fallback, before implementation. Qualified-only lookup would unhide all 37,106 items in the 2026-11-04 backup.
8. [TODO] **high** Blocker: verify real ZenMarket search-card links include `shop`. The highlighter records most items from search cards; the existing search fixture uses `product.aspx?itemCode=` without `shop`, which the user says fails. The two user-supplied URLs are item pages. Needs a user-shared ZenMarket search page.
9. [TODO] **high** Evaluate a flat registry with `<marketplace>/<id>` keys, e.g. `mercari/<id>`. `/` is excluded by `ID_PATTERN`, so prefixed keys cannot clash with legacy raw IDs; `:` is unsafe because ZenMarket IDs contain it. Reuses the write pipeline, pruning, panel count, and merge; restore still needs a format bump because old code rejects `/`. If adopted, simplifies tasks 2-4.
10. [TODO] **high** Define the new-shop prompt: once per shop name despite 1.5 s scans and several unknown shops per page; behavior for that shop's items before approval and after rejection. The 23 colon IDs in the 2026-11-04 backup indicate unmapped ZenMarket shops occur in real use.
11. [TODO] **medium** Drop the eBay prefix ambiguity from Decisions and Open Decisions: the 2026-11-04 backup has 0 `ebay_` entries, and eBay support shipped 2026-11-09, so all existing `ebay_` keys come from the eBay code and can be renamed directly.
12. [TODO] **medium** Mark the sync plan default "Preserve raw IDs and their case; no marketplace-prefix migration" in [PLAN_UserscriptsSync.md](PLAN_UserscriptsSync.md) as superseded by this plan.
13. [TODO] **medium** Verify the installed script and real selectors on authorized representative pages; offline VM tests alone do not prove Tampermonkey behavior. Obtain separate approval before installation, commit, or push.
14. [TODO] **low** Remove stale references to the resolved missing-shop question. Note that `buyeeItemSeen` has no listener in this repository, so preserving it is cheap.

## Devlog

- 2026-11-09: Existing registry stores unqualified IDs, so provenance cannot be recovered with certainty. Marketplace-level isolation is confirmed; handling old IDs is deferred to a separate decision, superseding the earlier indefinite-fallback choice.
- 2026-11-09: Local route tests cover three markets across the proxy sites, including mixed Buyee recommendations. They do not prove real ZenMarket missing-shop or Flea Market URLs; the existing item-links classifier cannot be reused unchanged because it rejects shops and IDs accepted by the highlighter.
- 2026-11-09: User supplied a real ZenMarket `auction.aspx?itemCode=<id>` URL. Its route matches the existing Yahoo auction classifier, but the integrated browser received a Cloudflare security-verification page and its challenge host failed DNS resolution. The listing content was not inspected; this auction URL does not resolve the missing-shop product question.
- 2026-11-09: User supplied a ZenMarket Mercari URL with `shop=mercari` and a Yahoo auction URL using `auction.aspx`; both align with the existing item-links mapping. The missing-shop example was a synthetic fixture, not evidence that such a real listing exists.
- 2026-11-09: User confirmed ZenMarket product URLs without `shop` fail. The synthetic missing-shop highlighter fixture is not a supported listing and must not block the marketplace identity design.
- 2026-11-09: User confirmed explicit alias mapping by underlying marketplace, independent of proxy site. User suggested warning when a completely new shop is encountered so its mapping can be added; warning and interim tracking behavior are not yet locked.
- 2026-11-09: User clarified that marketplace storage is the planned change, not an assertion. Yahoo Shopping is not explicitly supported; adding it and other new shops is deferred until needed.
- 2026-11-09: User superseded the deferral: prompt for an encountered new shop, and if confirmed add it to the local registry. Do not infer cross-platform alias equivalence from an unknown name.
- 2026-11-09: Plan review recorded as tasks 7-14. 2026-11-04 backup: 37,106 items, 0 `ebay_` entries, 23 colon IDs.