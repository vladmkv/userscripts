# Item Collector: Handoff Plan

Companion: [NOTE_ItemCollector.md](NOTE_ItemCollector.md) (requirements, decisions, proposals, open questions).
Related tracks: [PLAN_UserscriptsManualSync.md](PLAN_UserscriptsManualSync.md) (browser sync, separate),
[PLAN_UserscriptsIdentity.md](PLAN_UserscriptsIdentity.md) (marketplace plus ID; needed for the 35,000-ID import).
Date: 2026-11-17. Status: requirements captured; planning not started; nothing implemented.

## Where we are

The collector (scanner) autonomously reruns saved queries on a home server and writes item records per
query to its own database. That is its whole job. Treating records as streams, merging, tagging, presenting,
publishing to a messenger, and LLM analysis are downstream modules, out of scope. No browser reads
collector data. Read the companion note before any work; its requirement table (R1-R13) and Decisions
table are the source of truth, and its "Design proposals" section lists ideas that are not yet decided.

Working rules: plan before code; source edits, new repositories, server setup, and Git writes need
explicit user approval. Ask decisions with menus, one at a time. ASCII only.

## Tasks

1. [TODO] **high** Settle the open questions in the note: database choice and location (local SQLite
   proposed), item metadata the downstream analyzer needs, storage forecast for the 1-2 week purge.
2. [TODO] **high** Confirm or reject each design proposal in the note: scan cycle, discovery strategy as
   sort order plus stop condition, first-run backfill behavior, failure safety, parser reuse, fetching.
3. [TODO] **high** Define the query model: parameters, discovery strategy (eager or lazy with horizon),
   poll interval, page limits, and the edit-time choice to keep or restart a query's records.
4. [TODO] **high** Define the record schema: items keyed by marketplace plus ID, per-query records with
   discovery time, "last returned" time for purge, and the item metadata fields.
5. [TODO] **medium** Pick the first site and one real query; check whether plain HTTP or a JSON endpoint
   returns results, otherwise use a headless browser. Record the evidence.
6. [TODO] **medium** Decide where the collector code lives (new repository vs `.agent-tmp/userscripts`) and
   whether site parsers are shared with the userscripts.
7. [TODO] **medium** Purge job design: threshold (1-2 weeks, tunable), schedule, and strategy (a) sold
   revisits kept as a later option.
8. [TODO] **low** Import of the existing ~35,000 seen IDs as already-seen, after the identity plan settles
   legacy raw IDs.
9. [TODO] **low** Write the implementation plan (tasks, tests, deployment on headless Ubuntu) once 1-8 are done.

## Devlog

- 2026-11-17: Reframed the seen-ID sync as part of a larger collector system. The user moved merging,
  presentation, publishing, and analysis out of the collector; its only output is database records. Since
  no browser consumes collector data, the database can stay local on the home server.
- 2026-11-17: Browser-to-browser seen-item sync split into its own track and handoff, independent of the
  collector.
