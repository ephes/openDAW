# Round 93 library invariants

Codex implemented the scoped dispatch, binary/JSON admission and progress fixes.
Each source defect is covered by a regression demonstrated failing before its fix.
The implementation uses existing graph transactions and binary APIs. Validation
uses the local Checks workflow commands; no hosted checks or SDK publication.
Cross-family review and merging are reserved for the external review clerk.

## Validation

- Fresh SSH clone of main at `7b79c5081f29b2c1b4dc67172874b693fec10eff`;
  all eight source defects were still applicable.
- Before fixes: two dispatch regressions, five binary admission cases, eleven
  JSON cases and seven progress cases failed on their corresponding original
  implementations. Additional compatibility and boundary cases remained green.
- `npm ci --ignore-scripts`, `npm run build`, `npm run lint`, `npm test` pass
  locally. The full suite passes 2313 tests with one pre-existing skipped test;
  lint has warnings and no errors. No sandbox-blocked gate.
- Additional `npx tsc --noEmit -p packages/lib/box/tsconfig.test.json` and
  `npx tsc --noEmit -p packages/lib/std/tsconfig.test.json` cover authored tests.
- Package READMEs and Unreleased notes document the changed contracts. No
  versions changed. The feature branch is parked for external review; no merge,
  Claude invocation, hosted CI, deployment or release was performed.
