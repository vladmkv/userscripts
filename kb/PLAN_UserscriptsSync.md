# Userscripts sync: implementation, test, and deployment plan

Companion: [NOTE_UserscriptsSync.md](NOTE_UserscriptsSync.md), especially the comparison in Section 9.
Date: 2026-10-24. Status: implementation plan drafted; no sync source or database changes made.
Repository: `.agent-tmp/userscripts` (`github.com/vladmkv/userscripts`).

## Tasks

### Objective and scope

Synchronize the highlighter's retained seen IDs between Chrome/Tampermonkey installations using
Supabase per-record upsert plus change tracking. Keep browsing local-first, preserve the existing
page-load hide/frame rules, and support simultaneous collectors under one account.

This file authorizes no execution by itself. Source implementation, temporary browser installation,
cloud setup, SQL execution, credential setup, Git writes, and publishing require the corresponding
explicit approval. Never commit, push, switch branches, delete data, or provision remote resources
merely because a task below lists the action.

Concrete standard-pattern solutions for the gates are proposed below: an immutable local observation
journal, idempotent delivery, copy-on-write checkpoints, and ordinary PostgreSQL transactions. The gates
verify these adapters and invariants, rather than requiring an open-ended search for a new sync algorithm.
Browser persistence and database correctness still require evidence before production rollout; the existing
approval and database-before-highlighter implementation boundaries remain. A failed test should identify
a specific repair or explicitly approved alternative, not silently weaken concurrency or add an application.

### Decisions and defaults

| Item | Decision / planned behavior |
| --- | --- |
| Selected protocol | Per-record upsert plus change tracking; no normal whole-snapshot replacement, daily buckets, or explicit LRU queue. |
| First release | Automatically synchronize and display the result; retain a Sync now action and a persistent Sync enabled toggle. |
| Periodic check | `CHECK_INTERVAL_MINUTES = 5`, while browsing is active. |
| New session | `SESSION_IDLE_MINUTES = 15`; first active visit and resume after that inactivity trigger a check. |
| Setup state | Nothing created yet: new dedicated Supabase project, auth user, SQL setup, and keepalive setup are required. |
| Browser target | Google Chrome with Tampermonkey; do not claim Firefox or Edge verification. |
| Account scope | One email/password account with independent device sessions; simultaneous devices supported, separate-user sharing deferred. |
| Installed scripts | Keep all three; add sync to the highlighter with a separate panel, not a fourth production script. |
| Capacity | `MAX_TRACKED_ITEMS = 100_000`; a constant governing retention, independent of upload frequency and batch size. |
| Batch size | `SYNC_BATCH_SIZE = 1_000`; coalesce repeated pending observations for the same ID. |
| Recency | Record actual encounters once per ID per page visit; downloads, retries, repeated timer scans, and cache reads do not refresh it. |
| Pruning | Keep the newest `(last_seen_ms, item_id)` pairs with deterministic ties; an old ID encountered again receives a newer encounter time. |
| Overflow | Ordinary capacity eviction can discard old unsent entries; no oversized-queue workflow or unlimited outbox. |
| Display stability | IDs received after page load do not suddenly hide or frame cards; they affect the next reload, matching the existing regression test. |
| Restore | Merge-only while a sync account is configured; cancellation cancels, rather than offering Replace; local-only mode retains the existing merge/replace choices. |
| Keepalive | Plan a daily GitHub Action in a separate private repo; validate its effectiveness rather than asserting that any HTTP request prevents pausing. |

Engineering defaults, to be tested rather than presented as previously observed facts:
- Preserve raw IDs and their case; no marketplace-prefix migration.
- Represent recency as UTC integer milliseconds; use server revisions, not encounter timestamps, for delivery.
- Legacy records without timestamps start with unknown recency, represented by `0`, below dated encounters.
  This preserves membership without inventing historical dates; surface the migration policy before rollout.
- Reject malformed or implausibly future timestamps with a clear clock/data error, not a silent rewrite.
  Proposed future-clock allowance: five minutes; this is separate from the polling interval.
- Retry transient failures with bounded exponential backoff and jitter; respect Retry-After for 429.
  Proposed delay: 5 seconds initially, capped at 5 minutes; auth/validation failures do not hot-loop.
- Capture a request batch before sending; acknowledge only matching submitted observations, preserving newer
  observations collected while it was in flight.

### Files and ownership

All repository paths below are relative to `.agent-tmp/userscripts`.

| File | Planned change | Owner during implementation |
| --- | --- | --- |
| `Cross-Market-Seen-Item-Highlighter.user.js` | Local metadata/migration, sync transport and engine, scheduling, separate panel, grants, release version. | One client implementer at a time. |
| `tests/userscripts.test.cjs` | Extend the existing VM harness and reuse existing URL/DOM/storage tests. | Same client implementer; do not concurrently edit this shared file from another agent. |
| `supabase/seen-sync.sql` (new) | Versioned schema, constraints, RLS, narrowly granted RPC functions, and optional harmless keepalive RPC. | Database implementer. |
| `supabase/seen-sync.tests.sql` (new) | Transactional SQL assertions for permissions, ordering, retention, and capacity; fixture cleanup rolls back. | Database implementer. |
| `tests/seen-sync.live.test.cjs` (new) | Explicitly opt-in real REST/Auth contract and simultaneous-writer tests; never part of the default offline suite. | Database implementer. |
| `README.md` | Update the existing document with setup, migration, controls, recovery, and tested limitations. | Integrator after behavior is verified. |

Do not change `Neokyo-Category-Selector.user.js` or `Cross-Platform-Item-Links.user.js` for this feature.
Do not add a framework, build system, package scaffold, or new Markdown files inside the repository.
The SQL and opt-in test files are separate because deployment SQL, SQL-role assertions, and authenticated
HTTP/concurrency checks cannot all be established by the existing simulated DOM test.

Private keepalive repo: one `.github/workflows/supabase-keepalive.yml`; its name/creation is approved at
deployment, not silently created in the public userscripts repo. Use workspace `.agent-tmp/runs/<unique-run-id>/`
for probe scripts, test logs, screenshots, and disposable fixtures; never overwrite another run.

### Database contract to implement and verify

#### Data model

| Object | Fields / responsibility |
| --- | --- |
| `public.seen_items` | `user_id uuid`, `item_id text COLLATE "C"`, `last_seen_ms bigint`, `change_revision bigint`; primary key `(user_id, item_id)`. |
| `public.seen_sync_state` | One row per user: current revision and nullable eviction cutoff `(cutoff_seen_ms, cutoff_item_id)`; lock this row before any mutation of that user's retained state. |
| Capacity constant | Server-side administrative constant and client constant initially 100,000; return the server capacity in metadata and fail clearly on incompatible configuration. |
| Indexes | `(user_id, change_revision, item_id)` for delta pages and `(user_id, last_seen_ms, item_id)` for retention. |
| Validation | Bounded batch length, unique IDs within the submitted batch, raw ID grammar/length, finite integer timestamps, nonnegative revisions, and paired nullable cutoff fields. |

No deletion log or permanent tombstones are required for this capacity-only policy. After pruning,
store the greatest evicted `(last_seen_ms, item_id)` as a monotonic cutoff. All clients apply the same
ordering and discard observations at or below that cutoff; a genuinely newer encounter survives and
can reintroduce the ID. No explicit per-ID user deletion or server reset is included in this protocol.

The cutoff is sufficient only while pruning removes an oldest prefix under this exact ordering and
all mutations follow the protocol. Test ties, retries, stale devices, and newly encountered old IDs;
do not extend the same rule to arbitrary deletes, TTL expiry, or account resets without redesign.

#### RPC interface

Names below are proposed new interfaces, not existing functions.

| RPC | Input | Output / behavior |
| --- | --- | --- |
| `seen_sync_head()` | None; account comes from `auth.uid()`. | Protocol version, current revision as a decimal string, cutoff, capacity, and server time; no item payload. An uninitialized account is an explicit empty state, not a swallowed error. |
| `seen_sync_write(batch jsonb)` | At most 1,000 `{item_id,last_seen_ms}` observations; no caller-supplied owner or revision. | Authenticate, validate, lock state, ignore observations below the cutoff, atomically retain maximum timestamps, prune, and commit state/items under one revision; return acknowledgement, resulting revision, and cutoff. |
| `seen_sync_read_page(base_revision, expected_revision, after_revision, after_item_id, page_size)` | Revisions as decimal strings, stable continuation pair, page size at most 1,000. | Acquire the user's state lock in shared mode, reject/restart if current revision differs from expected revision, then return current rows newer than base revision in `(change_revision,item_id)` order plus the continuation and cutoff. |
| `seen_sync_ping()` | None. | Optional keepalive: return a constant boolean through the database; reveal no user data and require no user password or privileged key. |

Write rules:
1. All production writers use the RPC; do not grant direct table INSERT/UPDATE/DELETE to clients.
2. Create the state row safely on first use, then lock it `FOR UPDATE` before inspecting or changing item state.
3. Merge with `GREATEST(existing, incoming)`, apply the retained cutoff, and prune in the same transaction.
4. Increment the per-user revision only for an actual retained-state/cutoff change; retries and older/equal
   observations must not keep generating changes. Acknowledged-but-evicted data is not an upload failure.
5. The state-row lock serializes revision publication through commit, preventing the missing-late-commit
   problem of an uncoordinated sequence or client timestamp cursor.
6. Never advance a client's pull checkpoint to a revision obtained merely from its own upload: other
   writers' earlier changes may not yet have been downloaded.

Read rules:
- Each page validates the expected head under the shared state lock; mutations must take the conflicting
  lock first. A revision change between pages returns an explicit restart result, not a mixed snapshot.
- Accumulate/merge pages without advancing the completed checkpoint; publish the new local checkpoint
  only after the complete pull and cutoff are persisted successfully.
- On restart, discard the incomplete page traversal and refetch from the last completed checkpoint;
  repeated contention defers to a later retry rather than spinning indefinitely.
- Only current retained rows are needed: intermediate timestamp versions may be coalesced, while the
  cutoff explains capacity removals. A new device uses base revision zero and downloads retained rows.

Security rules:
- Enable RLS and bind every private RPC to a non-null `auth.uid()`; no parameter chooses another user.
- If SECURITY DEFINER is necessary to deny direct writes, use a fixed safe search path, fully qualified
  names, a reviewed owner, and explicit EXECUTE grants; revoke default PUBLIC execution.
- Private state/item data and private RPCs are unavailable to anon; only the harmless ping may be public.
- Do not expose service-role/secret keys in userscripts or the keepalive workflow; disable public sign-ups.
- Auth/RLS tests must use actual authenticated HTTP sessions as well as SQL-role checks, not only the
  SQL editor's privileged connection.

### Client contract and integration points

#### Proposed standard-pattern solution

The problem is routine synchronization; the awkward part is the GM storage interface, not the domain.
Bookmark/file-sync applications commonly put a transactional local store behind one background writer.
Tampermonkey does not expose that same application-owned transaction boundary across our three origins.
Use the following established patterns without building another application or a general replication library:

| Concern | Pattern and concrete proposal | Why it addresses the gate |
| --- | --- | --- |
| Concurrent local observations | Write-ahead journal / durable outbox: every persisted batch has a unique, immutable GM key. | Tabs never replace one another's authoritative observation data; there is no shared read/modify/write operation to lock. |
| Duplicate or reordered delivery | Idempotent max-register per ID: retain `max(last_seen_ms)` for matching IDs. | Replaying an observation or receiving it out of order has the same retained effect; do not attempt exactly-once transport. |
| Local read performance | Materialized in-memory view and the existing registry projection. | The scanner reads a map; durable journals are storage detail, not a new per-card network dependency. |
| Crash-safe acknowledgement | Copy-on-write remote checkpoint containing both confirmed records and their completed revision/cutoff. | Data and checkpoint cannot be independently advanced; old durable inputs survive until a replacement is published successfully. |
| Remote concurrent writers | Existing per-account state-row transaction, atomic upsert, and stable revision checks. | Use the database's locks/transactions rather than a separate server, client mutex, or custom distributed lock. |
| Duplicate sync workers | At-least-once work with idempotent server operations; advisory polling coalescing. | A temporarily duplicated worker may do redundant requests but must not lose data; correctness does not depend on electing exactly one tab. |

No journal precedent was found in this repository; the current `saveVerified` path provides a reusable
read-back check but not the concurrency mechanism. The alternative is an application-owned central
writer with transactional IndexedDB, normally in an extension background context; that is a larger scope
change requiring approval, not a silently introduced dependency. Origin-scoped Web Locks/IndexedDB alone
cannot supply one shared store across Buyee, ZenMarket, and Neokyo.

#### Local layout and publication rules

This replaces the earlier proposal for one shared mutable `seen_sync_local_v1` object.

| Local object | Publication / read rule |
| --- | --- |
| `seen_sync_journal_v1:<epoch>:<uuid>` | Immutable, validated batch of coalesced ID/timestamp observations, account binding, and any carried local eviction cutoff; never append to an already published key. |
| `seen_sync_checkpoint_v1:<epoch>:<uuid>` | Immutable complete confirmed remote view with account binding, completed server revision, and remote cutoff; publish only after a complete validated pull. |
| Materialized retained view | Select the latest valid remote checkpoint for the active account/epoch, merge published journal observations by maximum timestamp, apply the greatest relevant cutoff, and keep the newest capacity-limited set. |
| `buyee_item_registry` | Compatible `{id:'hide'}` projection only; not the authoritative store or a multi-writer synchronization primitive. |
| Change hint / scheduler preferences | Mutable hints may be overwritten; missed notifications or duplicate polling cannot affect durable data correctness. Enumerating journal/checkpoint keys is the recovery path. |
| Config and SDK session storage | Separate from item journals/checkpoints and backups; authentication coordination has its own test below. |

Candidate adapter uses awaited `GM.setValue`, `GM.getValue`, `GM.listValues`, and `GM.deleteValue`
for new durable operations, with only the necessary grants. Verify the installed Tampermonkey version's
completion/visibility behavior in B1; neither a Promise nor local read-back is a claim of hardware-level
power-loss durability. Existing synchronous APIs may remain for non-authoritative compatibility/UI data.

1. Each scan coalesces its new observations into a batch, assigns a unique key, writes it, and awaits
  confirmation before reporting it saved. A failed append stays in that tab's memory with the existing
  unsaved-data warning; no system can promise persistence after the storage API itself fails.
2. Rebuild the local view from durable inputs before taking `seenAtPageLoad` and starting scans. Persist
  observations before updating the optional projection; a stale or failed projection is rebuilt, not
  imported back as fresh observations after migration.
3. Sync workers read immutable observations and may submit them more than once. Do not delete a batch
  merely because its HTTP upload succeeded: first publish a complete durable confirmed checkpoint that
  covers its observations or their permitted capacity eviction.
4. A checkpoint carries its data and revision in one value. Select by completed server revision, not local
  completion time; an older in-flight pull cannot replace a newer checkpoint. Equal-revision confirmed
  views must agree after canonical ordering, otherwise report a protocol/storage defect.
5. Cleanup removes only captured immutable keys whose effects are covered by a successfully published
  replacement or confirmed checkpoint. It must never delete all matching keys by prefix, clear a shared
  pending map, or delete a newer batch that appeared while the request was running.
6. Notifications invalidate the in-memory view and wake eligible work; they do not carry authoritative
  state or credentials. If a captured input disappears during enumeration/read, refresh the input set
  instead of assuming it was empty or skipping it permanently.
7. Compaction is copy-on-write: capture input keys, merge them, publish and verify the replacement under
  a fresh key, then retire only those captured inputs. Overlapping compactors can leave duplicate outputs;
  max-merge removes duplicate effects, and a later pass cleans them up without a correctness-critical lock.
8. Preserve the maximum local eviction cutoff when compacting, including when no observations remain;
  otherwise a delayed old batch could revive locally evicted history. Prune the materialized view before
  deciding what pending observations survive under the already-approved capacity policy.
9. Compact during successful sync and at a small segment-count threshold while offline (proposed: 32
  segments, not 100,000 queued IDs). Keep logical retention bounded; copy-on-write can temporarily duplicate
  storage bytes, but completed compaction must not leave an ever-growing journal or checkpoint history.

Suggested pure helper boundaries inside the existing highlighter: `mergeObservations`,
`materializeRetainedView`, `appendObservationBatch`, `publishRemoteCheckpoint`, and
`compactObservationBatches`. These are proposed helpers, not existing APIs or a new framework.

Reset boundary: max-merge handles observations, not replacement. For confirmed local-only Restore Replace,
publish the complete replacement baseline under a new local epoch before making that epoch active; tag
all batches/checkpoints with their epoch and ignore late callbacks from superseded epochs. A proposed
deterministic epoch order is `(generation, uuid)`, with generation greater than observed generations;
do not rely on a wall-clock timestamp or a mutable latest-pointer alone. Account changes must likewise
not mix journals across bindings. Validate this suggestion in S3 before claiming Replace compatibility.

#### What the gates now verify

- B1 is an adapter and recovery test for the journal/checkpoint design, not a search for a GM compare-and-swap
  lock. Force two tabs to append from the same starting view, discard notifications, race compaction, and
  close either tab at each publication boundary; retained observations must still reconstruct correctly.
- D1/D2 implement and test the specified PostgreSQL transaction and cursor rules; they are ordinary
  database correctness/security gates, not an unresolved need for a new backend architecture.
- Browser-specific acknowledgement semantics, storage limits, and SDK token rotation remain integration
  facts to establish. If a test disproves an assumption, identify that exact assumption and choose the
  smallest approved repair; do not label an untested combination of standard patterns "bulletproof".

#### Integration behavior

| Existing function / surface | Required change |
| --- | --- |
| `loadRegistry` / `readStoredRegistry` | Migrate legacy membership into journal observations once; thereafter materialize checkpoints plus journals before page-start snapshotting and repair the compatible projection as needed. |
| `markSeen` | Record a genuine new observation and pending timestamp; retain existing seen/hide membership behavior. |
| `processStateEngine` / `processZenMarketItemPage` | Touch already-known IDs once per actual page visit before the existing early returns; do not refresh all records every 1.5 seconds. |
| `pruneRegistry` | Order by encounter timestamp and raw ID, not JavaScript object-key order; only sort when pruning/reconciliation needs it. |
| `flushPendingWrites` / `saveVerified` | Append and verify a unique immutable observation batch, then refresh the derived view/projection; local persistence failures remain visible and retry independently of network failures. |
| `downloadBackup` / `applyBackup` | Export a version-2 backup with membership and recency but no credentials; accept legacy version-1/missing-version backups as unknown recency. Preserve cancellation and disabled-sync replace behavior. |
| `seenAtPageLoad` / `seenThisVisit` | Preserve the current visit's visual semantics even when the registry changes remotely. |
| Panels | Keep the existing registry panel; add a distinct compact sync panel on search pages without overlap, initially top-right. Detail pages keep their existing no-panel behavior; saved sync status is shown on the next search page. |

Migration must validate unsupported legacy values/IDs and stop with an actionable message rather than
silently discarding them. The original regex accepts arbitrary-length IDs, whereas the proposed server
limit is 64; report any incompatible legacy records before enabling uploads, without logging their contents.

#### Auth and transport

- Prefer the official Supabase browser client, pinned to a verified exact version via userscript `@require`,
  instead of implementing token rotation. No npm/bundler scaffold is required for the userscript.
- Supply a GM-backed session storage adapter and a tested fetch adapter using `GM_xmlhttpRequest`;
  verify actual SDK requests, refresh behavior, timeouts, and storage coordination in Chrome.
- Do not infer that the idempotent item protocol makes token refresh idempotent. Test concurrent refresh
  across different marketplace origins, including a delayed response; do not assume the SDK's same-origin
  coordination automatically covers shared GM session storage. S4 records the fallback decision if needed.
- Add only necessary grants and the created project's exact Supabase host to `@connect`; no `@connect *`.
- Config accepts an HTTPS Supabase project URL, publishable key, and email. Reject secret/service-role
  credentials; password exists only during sign-in and is never persisted, exported, or logged.
- Use local-scope sign-out so another device is not signed out. Preserve data/pending observations when
  disabling sync or signing out. Changing account/project requires explicit confirmation and rebootstrap;
  do not silently upload one account's pending registry to another.
- Never print Authorization headers, refresh tokens, passwords, or entire API error objects. Deployment
  credentials are entered directly into the browser/terminal, never into chat or ask-questions responses.

#### Automatic reconciliation and UI

1. Unconfigured, signed-out, or disabled sync makes no data-sync requests; local highlighter behavior continues.
2. At session start/resume or the five-minute active interval, request metadata. Coalesce normal polling
  with shared timing hints and one in-flight run per tab; do not run a request on every scroll or every
  navigation. Occasional racing workers must be harmless rather than relying on a fake cross-origin lock.
3. A matching remote revision does not suppress uploading local pending observations. Snapshot pending
   batches, upload, acknowledge only matching observations, then pull from the last completed checkpoint.
4. If remote data changed, pull pages, merge maximum timestamps with the latest local observations, apply
   the cutoff and capacity, verify persistence, and finally advance the completed checkpoint.
5. Activity/focus/visibility events update scheduling state; inactive or hidden-only browsing does not run
   indefinitely. A visible return after 15 minutes triggers one new-session check, subject to retry/auth state.
6. Sync now uses the same engine and coalesces with that tab's in-flight run; another tab/device may run
  concurrently, which is safe under the immutable journal and idempotent database protocol.
7. Show local pending count, last successful sync time, progress, offline/retrying, sign-in-required, and
   actionable validation/storage errors. Do not label every failure as a paused Supabase project.
8. Include setup/sign-in, Sync now, Sync enabled, and local sign-out controls; automatic sync reports its
   result without recurring modal confirmations or silently changing the current page's hide snapshot.

### Implementation sequence and gates

1. [DONE] Record product decisions and file permission: per-record protocol, automatic v1 sync, five-minute
   checking, 15-minute inactivity threshold, Chrome/Tampermonkey, fresh cloud setup, and this companion plan.

2. [TODO] Validate the proposed immutable GM journal/checkpoint adapter in a disposable profile. **high**
  Use scratch-only probes and synthetic observations, not production registry keys or extra marketplace
  browsing. Execute suggested S1/S2 below: append unique keys, publish checkpoints, reconstruct views,
  and exercise copy-on-write cleanup under simultaneous writers and restarts. No Supabase account is
  needed; live SDK/session verification belongs to Task 6. Record exact API/version behavior. Gate B1:
  no lost retained observations in the named interleavings, no unbounded completed journal history, and
  no dependence on reliable notifications or exclusive tab leadership. No highlighter source edits yet.

3. [TODO] Implement the database contract, SQL assertions, and opt-in HTTP test runner. **high**
   Create only the three database/test files listed above; review permissions and all mutation entry points.
   Validate max-timestamp merge, monotonic cutoff, commit-ordered revisions, no-op retries, and page restart
   semantics. The large capacity boundary can be generated in a rolled-back SQL fixture rather than
   treating a huge queue as a normal user workload. Gate D1: SQL review and all required cases specified;
   live success is not claimed until Task 4.

4. [TODO] Provision the dedicated Supabase project and pass the real database/API gate. **high**
   Obtain explicit approval for cloud creation, schema application, temporary auth users, and fixture writes.
   Apply SQL to the fresh project; create test account A with two sessions and isolation account B; keep
   public sign-ups disabled. Run the SQL assertions and live HTTP tests using those test accounts, then
   create the production account only after the gate passes. Remove test accounts/data only with approval.
   Gate D2: all database cases below pass, including a delayed concurrent transaction; production registry
   remains untouched. Do not begin highlighter implementation before B1 and D2 pass.

5. [TODO] Implement local state, recency, migration, and backup/restore. **high**
   Change the existing highlighter and test file only; preserve original migration markers and script identity.
  Use the B1-verified journal adapter, journal-before-projection ordering, unknown-recency migration,
  deterministic capacity pruning, and versioned backups, including the S3 reset boundary. Gate C1:
  `sync storage:` tests plus the existing
   suite pass; new observations survive injected failed writes and reloads; no network is needed.

6. [TODO] Integrate pinned Supabase SDK, configuration, authentication, and GM transport. **high**
   Pin the verified SDK version and least-privilege grants/domain; do not publish an unresolved metadata
   placeholder. Add setup validation and redacted errors; verify refreshing/sign-out on two tabs/profiles.
   Gate C2: `sync transport:` tests pass, no secret appears in storage outside the SDK session key, backup,
   console, test logs, or repository; password is never persisted. Tokens necessarily remain in GM session storage.

7. [TODO] Implement batched push, delta pull, acknowledgement, and cutoff application. **high**
   Preserve pending changes collected during requests; do not advance pull state from upload acknowledgements.
   Handle partial batch success, lost responses, page restarts, stale clients, capacity eviction, and offline
   recovery using the contract above. Gate C3: `sync engine:` tests pass, including simultaneous collectors
   and writes to the same ID arriving out of order; unchanged data does not generate endless uploads.

8. [TODO] Add automatic scheduling and the separate sync panel. **high**
   Implement five-minute checks, 15-minute session resume, profile-wide request coalescing, manual override,
   enable/disable, and persistent status. Keep network calls outside the scan/scroll handler. Gate C4:
   `sync schedule:` and `sync ui:` tests pass; ordinary navigation does not cause another fresh check,
   and unchanged remote metadata still permits local pending uploads.

9. [TODO] Run final automated regression and real Chrome/Tampermonkey validation. **high**
   Run the entire existing test file with all new tests, the live API suite, and the browser matrix below.
   Retain all baseline behaviors; update implementation-specific write-count assertions only to reflect the
   documented metadata/projection writes, not to weaken behavior tests. Gate R1: no unexplained failures,
   no skipped required cases, actual payload/storage measurements recorded, and all remaining limitations named.

10. [TODO] Prepare keepalive and operating documentation. **medium**
    After explicit approval, create the private keepalive repo/workflow with daily scheduled and manual
    dispatch, minimal permissions, a short timeout, and bounded retries; no checkout is needed for one RPC call.
    Store URL/publishable key in repository variables/secrets as appropriate; do not store user passwords or
    privileged Supabase keys. Update the existing README and highlighter release version (expected 7.24
    from the inspected 7.23 baseline); category selector/item-links versions remain unchanged. Gate O1:
    manual heartbeat succeeds, workflow exposes no private data, documentation matches tested behavior.

11. [TODO] Pilot on the user's two Chrome installations without publishing first. **medium**
    Back up each existing Tampermonkey installation, then update its existing highlighter entry rather than
    deleting it or installing a duplicate. Configure the same production account with separate sessions,
    verify migration and initial sync, then add distinct test observations from both installations and confirm
    convergence. Use tools where available; user-only credential entry and an inaccessible second PC are
    explicit manual steps. Gate P1: exact expected retained IDs/timestamps agree after a quiet final sync,
    not merely equal counts; normal browsing and offline recovery work.

12. [TODO] Publish only the approved tested changes and verify auto-update. **medium**
    Inspect current Git status through the safe-command adapter; preserve unrelated changes. Propose commits
    and request separate approval for each Git write/push; no automatic branch creation or direct publishing.
    Ensure backend protocol v1 is deployed before userscript v1. Push the approved release, confirm the raw
    update/download URLs and version, reload existing browser tabs, and confirm the stored registry survives.
    Gate P2: production sync and published update verified; no secrets or unrelated script changes in the diff.

13. [TODO] Complete the keepalive observation and close deployment evidence. **medium**
    Record scheduled runs and project availability over more than one week without marketplace traffic
    before calling pause prevention verified. A successful single ping proves reachability only. Leave this
    task pending if the observation window has not elapsed; do not delay reporting the independently completed
    client pilot or claim a future outcome. Gate O2: observed availability or a documented fallback decision.

  ### Suggested supporting steps

  These are concrete additions requested while assuming the gates are still unverified; all remain TODO,
  and no prototype/source execution is authorized by writing them. They fit into the existing tasks rather
  than creating another project or service.

  1. [TODO] S1: Model the merge and recovery invariants before the browser probe. **high**
    Use small deterministic fixtures and the existing Node/VM style: verify associativity, commutativity,
    and idempotence of observation merge; deterministic top-K/cutoff behavior; and reconstruction against
    a sequential reference result. Include old IDs with new timestamps, equal timestamps, and retries.
    First implement in scratch if required by the database-before-source boundary, then reuse the cases
    in the existing test file during Task 5. Outcome: a specific failing interleaving, or a reproducible pass.

  2. [TODO] S2: Exercise immutable publication and concurrent compaction. **high**
    Schedule tab A and tab B from the same initial view; both append, both may upload, and either may close.
    Pause before/after checkpoint publication and before input deletion; race two compactors over overlapping
    inputs; add a fresh batch after input capture; drop notifications and replay completed uploads.
    Checkpoint revision never regresses, new batches remain, and reconstructed retained data matches the
    reference. Verify awaited GM operations and browser restart in real Chrome; no cloud is needed for B1.

  3. [TODO] S3: Verify migration, Restore Replace, and account boundaries using local epochs. **high**
    Specify and test the complete-baseline-before-epoch-publication rule; resume an old tab after replacement
    and ensure it cannot restore old history or clear a new epoch's data. Keep merge restore monotonic;
    permit Replace only under the existing local-only rule. If deterministic epoch publication does not
    preserve the existing contract, propose a narrowly scoped recovery UI change for approval, not a silent
    loss of Replace behavior. No arbitrary remote deletion is introduced.

  4. [TODO] S4: Test the official SDK's shared-GM session adapter after project setup. **high**
    Force simultaneous refresh on two origins and a late refresh response; verify continued authentication
    and local-scope sign-out without leaking credentials. If the shared adapter is unsafe, propose independent
    per-origin sessions (additional sign-in per origin, standard SDK/Web Locks within each origin) or a
    centralized coordinator as explicit alternatives; obtain approval for either behavior/scope change.
    Do not hand-roll a refresh-token protocol or present an advisory polling lease as an authentication lock.

  5. [TODO] S5: Verify the existing SQL design with a compact two-writer schedule. **high**
    Writer A holds the per-account transaction; writer B and a page reader contend; release A and verify
    commit-ordered revisions, atomic maximum timestamps, restart behavior, cutoff propagation, and unchanged
    revision on retry. This validates the selected transaction pattern; it is not a reason to reopen snapshot,
    daily-bucket, or multi-service designs unless a concrete requirement changes.

### Test cases and required evidence

Use stable prefixes for new Node tests so narrow commands are reproducible. The names below are planned
new cases, not tests that already exist. A zero-match filtered run is not a passing gate.

| Group | Required cases |
| --- | --- |
| Existing regression | All reported 44 baseline cases: marketplace parsing, startup hiding vs current-visit frames, Mercari bottom sweep, detail visibility, legacy cleanup, panel movement, backup/restore, failed saves, and independent selector/link behavior. |
| `sync storage:` | Legacy/missing-version backup migration; unknown recency; invalid input rejection; once-per-visit recency; merge algebra and deterministic ties/cutoffs; unique concurrent appends; lost notifications; checkpoint ordering; publish-before-delete crash points; overlapping compactors; new batch during cleanup; offline compaction bounds; stale projection repair; reset epochs and old-tab callbacks. |
| `sync transport:` | Disabled/unconfigured zero requests; strict URL/key validation; timeout/network/401/403/429/5xx handling; retry limits; simultaneous cross-origin refresh and delayed response; local sign-out; origin/grant validation; no credentials in exports/logs; incompatible protocol/capacity. |
| `sync engine:` | 0, 1, 1,000, and 1,001 pending records; newer update during upload; first batch succeeds/second fails; lost acknowledgement; duplicate and out-of-order timestamps; own-upload revision does not skip another writer; pagination with shared revision; page restart; persist failure does not advance cursor; cutoff rejects stale history but preserves newer encounters; initial sync. |
| `sync schedule:` | First session; resume just below/at 15 minutes; checks just below/at five minutes; repeated navigation; hidden/idle/sleep/resume; multiple tabs; no direct network on scroll; concurrent Sync now; local pending with unchanged remote revision; retry/auth state prevents a request storm. |
| `sync ui:` | Separate panel; automatic progress/result/error states; disabled/sign-in states; no collision with existing movable panel; no detail-page panel; remote changes leave this visit's hiding/frame snapshot unchanged; restore merge-only when configured. |
| SQL assertions | Auth and owner isolation; direct mutations denied; malformed/oversized batches; no-op revision stability; atomic max merge; capacity plus one; tie-order cutoff; cutoff monotonicity; old IDs reintroduced only by newer observations; transaction rollback leaves no partial state. |
| `sync live:` | Two sessions of account A write disjoint/same IDs; account B cannot observe/mutate A; delayed commit cannot fall behind the read cursor; page invalidation under a concurrent write; duplicate retry and acknowledgement; public ping reveals no registry data. |

Commands from the workspace root, with output captured to a fresh run's log when executed:

```powershell
node --test --test-reporter=tap --test-name-pattern="^sync storage:" .agent-tmp\userscripts\tests\userscripts.test.cjs
node --test --test-reporter=tap --test-name-pattern="^sync transport:" .agent-tmp\userscripts\tests\userscripts.test.cjs
node --test --test-reporter=tap --test-name-pattern="^sync engine:" .agent-tmp\userscripts\tests\userscripts.test.cjs
node --test --test-reporter=tap --test-name-pattern="^sync (schedule|ui):" .agent-tmp\userscripts\tests\userscripts.test.cjs
node --test --test-reporter=tap .agent-tmp\userscripts\tests\userscripts.test.cjs
node --test --test-reporter=tap .agent-tmp\userscripts\tests\seen-sync.live.test.cjs
```

The last command is opt-in only: the runner must require an explicit live-test enable flag and credentials
supplied directly to the local environment, fail clearly if required setup is absent, and never fall back
to a real user's production data. SQL assertions are separately executed against the approved test
accounts/project; include role changes and rollback, not unqualified deletion of public tables.

For the delayed-commit case, use real database connections in addition to the HTTP sessions: leave one
approved test transaction open after `seen_sync_write`, start the competing writer/read-page request,
then release the first transaction and assert revision order/restart behavior. Preflight an available
PostgreSQL client or obtain approval for the smallest required test dependency; a mocked HTTP delay is
not evidence of database commit ordering, and a missing test client leaves this gate incomplete.

Record runner versions, executed case counts, failures, and log paths; report summaries, not complete logs.
Use the existing Node test tooling; no new general test framework. Tests are not rerun merely because
this Markdown plan was written.

#### Browser matrix

- Two Chrome profiles with independent Tampermonkey stores; two tabs in one profile on different supported
  origins; also exercise the eventual two physical PCs before final rollout.
- Prefer synthetic fixtures/disposable test pages for volume, failures, and concurrency. Use only existing
  or user-supplied marketplace URLs for necessary smoke tests; no bulk marketplace browsing or crawling.
- Validate real GM persistence after reload/browser restart, permissions, actual SDK requests, expired
  sessions, network offline/online, visibility/idle transitions, and version update of the existing entry.
- Check a normal desktop and narrow browser window for both panels, text overflow, and button reachability;
  preserve existing visual language rather than redesigning the application.
- Record actual serialized payload at representative sizes including capacity, and Supabase usage after
  tests; label measurements separately from the earlier hypothetical 1 MB estimate.
- If available tools cannot operate the real Chrome/Tampermonkey profile, mark those cases unverified and
  request only the specific unavoidable user actions; integrated-browser VM execution is not a substitute.

### Deployment and rollback checklist

| Stage | Required evidence / safeguard |
| --- | --- |
| Before cloud writes | Approved project/account setup; schema and permissions reviewed; no existing application shares this database. |
| Before client edits | B1 and D2 passed; journal/checkpoint adapter and RPC contract verified; no unresolved silent data-loss path. |
| Before pilot | Backups from both installations kept outside the repo; local migration and restore tested; production account distinct from test fixtures. |
| Before publish | Full offline suite, approved live tests, browser evidence, redacted diff/log review, and explicit commit/push approval. |
| First rollback action | Disable sync locally while retaining registry and pending state; do not drop tables, clear storage, or sign out other devices. |
| Backend issue | Stop client synchronization and roll forward a compatible fix; keep data and protocol version explicit. |
| Hard client downgrade | Requires separate approval and verified backup/export; 7.23 does not understand new metadata and has a smaller 60,000-entry cap, so downgrade is not automatically lossless. |
| Re-enabling after rollback | Verify account binding, migration state, retained cutoff, and cursor; do not treat stale compatibility data as new observations without an explicit recovery operation. |

Completion means the selected protocol and all required production gates pass, or an explicitly accepted
limitation is recorded; a passing mock suite alone is insufficient. Keepalive observation may be separately
pending and must be reported as such.

### Delegation plan

- First authorize and execute the feasibility/database phase only; do not start multiple production
  implementers while B1 or D2 is unresolved.
- The first local assignment is now bounded: implement/test the S1/S2 journal model and GM adapter in
  scratch, returning the forced-interleaving results; it is not an open-ended search for a locking library.
- Database assignment: the SQL deployment/assertion files and opt-in live runner; return exact RPC contracts,
  security/concurrency evidence, and failure cases. No highlighter or shared VM test edits.
- Client assignment after gates: highlighter plus existing test file, one task at a time, narrow tests after
  each substantive edit; return diff summary, executed tests, and remaining browser checks.
- Review assignment after integration: read-only protocol/security/regression review, especially cursor
  ordering, cutoff behavior, credential handling, and changes collected during requests.
- Integrator retains approval handling, plan/NOTE updates, final full-suite validation, real browser rollout,
  and publishing. No delegate commits, pushes, provisions, or deletes without separate authorization.

### Pattern references and limits

- [Outbox pattern and idempotent consumers](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): reuse persist-before-delivery and safe replay, not the AWS services; the GM journal itself is authoritative, so this is not a claim of a multi-key GM transaction.
- [Web Locks origin scope](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API): useful within an origin, not a cross-marketplace mutex.
- [Tampermonkey storage APIs](https://www.tampermonkey.net/documentation.php?locale=en): key listing, value storage/deletion, and notifications are documented; API availability does not establish transactional or power-loss guarantees.
- [PostgreSQL upsert](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT) and [concurrent updates](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED): the selected server transaction pattern uses existing database guarantees.

## Devlog

- 2026-10-24: The handoff's insert-only union no longer matched bounded recency and concurrent collection.
  The user selected per-record upsert/change tracking; this plan uses timestamped records, a per-account
  commit-order revision lock, and a capacity-only eviction cutoff instead of an ever-growing deletion log.
- 2026-10-24: Earlier discussion left manual versus automatic behavior open. The user selected automatic
  synchronization with visible results from v1, checks every five active minutes, and a new-session check
  after 15 minutes idle; manual-only descriptions in the comparison are now historical alternatives.
- 2026-10-24: The user confirmed no cloud setup exists, selected Chrome/Tampermonkey, and approved creation
  of this plan plus updating the companion note; deployment therefore starts with new infrastructure.
- 2026-10-24: Reading the existing README/test harness confirmed that current GM read/merge/write is not
  transactional and that remotely added IDs intentionally do not change current-visit visuals. This plan
  preserves the visual contract and makes real cross-tab persistence a blocking feasibility gate, rather
  than claiming an unverified lock is sufficient.
- 2026-10-24: Existing source/tests and README were read for this planning pass; no implementation, database
  operation, delegation, or new test run was performed. The reported 44-test baseline must be rechecked
  before implementation; this document records planned gates, not successful execution of them.
- 2026-10-24: The user requested actual solutions for the unverified gates rather than an open-ended
  feasibility task. Replaced the shared mutable canonical-state proposal with immutable observation batches,
  a materialized view, copy-on-write remote checkpoints, and publish-before-delete compaction. Duplicate
  workers are safe at the data-protocol level, so advisory polling coordination is not treated as a lock.
  Added S1-S5 for merge/recovery invariants, real GM behavior, replacement epochs, SDK refresh, and SQL races;
  the integration-specific assumptions remain explicitly unverified, with no source or cloud changes made.