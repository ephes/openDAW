# Scout round 43: save recovery and checks

Implemented with Codex; review uses Opus 5.5 high via the Claude review harness. Synthetic mocks reproduce
truncate/write/close failures and retry after abort. A four-element constrained invalid collection reproduces
the Zod bounds issue without memory pressure. Valid sample/soundfont catalog fixtures preserve schema behavior.

The Zod advisory and upstream size-check fix were verified against the primary GitHub advisory/commit.
Only Zod package declarations and the corresponding lock entries change. Unrelated audit findings remain.

The CI workflow pins supported Node 26.13.0 and declared npm 11.4.2, installs from the lock, then runs root
tests, SDK builds/type checks and lint without secrets or deployment commands. Existing lint baseline
errors remain visible and block merging this bundle; no rules are disabled and no failure is ignored.

Validation: four save regressions and the constrained-Zod regression fail against the original code.
DOM tests (7), std tests (283), root tests and SDK builds/type checks pass after repair; DOM and core test
TypeScript checks pass. Optional std test TypeScript exposes existing color.test.ts TS2702 errors (lines 3–5),
reproduced in the unmodified main checkout. Actionlint accepts the workflow. An intentionally failing
synthetic unit caused the exact root npm test command to exit 1; the probe was removed and root tests rerun.
Locked audit: 61 remaining findings (31 moderate, 26 high, 4 critical); Zod/GHSA-mrhx-c7xc-m3w5 absent.

First review found one new no-empty lint error in the cleanup catch. Moved the explanatory comment inside
that block, preserving behavior. Acknowledge that new regression files add entries to the existing ESLint
project-exclusion failures; correcting the repository's lint configuration is outside this minimal bundle.

Second review: CLEAN, no findings. Root tests and SDK build/type checks pass after repair.
The feature branch remains unmerged because required lint is red. GitHub's branch-tip Checks run
will exercise the same install/test/type/lint commands on Ubuntu; its conclusion is reported with delivery.
