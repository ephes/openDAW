# Scout round 70–72 implementation process

Scope: the openDAW slices from round 70 (binary fidelity, shared-stream ownership,
live-frame recovery, bounded Yjs callbacks, preference lifetime) and round 72
(voice transitions, filters, mappings/pools, routing, effects, modulation, musical
time and bounded analysis/runtime timing). Round 71 contains no openDAW slices.

Codex implements each bundle after checking the current default branch. Tests
exercise actual public implementations using synthetic audio, binary frames,
Yjs documents, transports, storage and clocks. Production regressions are run
against the unchanged implementation before the narrow repair; coverage-gap
slices may pass initially and do not require artificial production changes.
Independent analytic expectations, partition equivalence and untouched-range
sentinels avoid freezing implementation details or platform behavior.

Claude Opus 5.5 at high effort reviews each bundle through the isolated review
harness. Required findings are repaired and reviewed as a delta, stopping at the
owner's four-round/repeated-finding limit. Suggestions receive an explicit
proportionality decision. Package READMEs and Unreleased notes describe contracts.

Local validation follows README: npm ci --ignore-scripts, root build (including
production TypeScript and generated sources), lint, and aggregate tests. Fetch
before each local no-fast-forward merge; if origin moved, rebase and revalidate.
Repeat all local checks after merging, then push only main and verify ls-remote.
Merge messages carry [skip ci]; no Actions, deployments, releases, tags or PRs
are part of this campaign. No source under ~/projects is modified.
