# Timeline gesture ownership and admission

## Marker targeting

Warp hit testing chooses the nearest marker within the existing four CSS pixel
radius. Equal distances retain the first marker in position order. Double-click
and context-menu deletion use that same target. Neighbor queries use strict
position comparisons, including fractional pulses; insertion may include the
marker at the requested position on its left side.

## Warp drag transactions

Warp drags preview the marker handle locally. Audio mapping changes on approval,
which creates one undoable edit. Pointer cancellation, Escape, capture loss and
editor disposal discard the preview without a marker mutation or position undo
entry. Normal pointer-down selection still applies and may itself be undone.
Each movement and approval resolves current attached marker membership and strict
neighbors, refusing intervals narrower than twice the minimum marker spacing.
Changes to the dragged marker's position or source seconds retire its proposal;
external edits survive both cancellation and approval.

## Transient analysis admission

Transient hover and insertion require a finite, strictly increasing snapshot of
both warp positions and source seconds, with at least two markers. Invalid or
unrepresentable mappings return `null`, hide the insertion cursor and create no
marker. Mapping accounts for the waveform offset. A cached hovered transient is
usable only while its box remains attached and its identity is present in the
current audio file's transient collection; replacing analysis requires a new hit.

## Selected note movement

A move/copy captures note identities and collection owners at pointer-down. Both
pitch and property painters use the gesture's owned selection for previews;
copy origins use the identity strategy and previews apply only to surviving owned
notes, so a later selection change cannot add another note to the gesture or
remove an original note from its preview. Detached/reparented notes are skipped;
copying uses the original attached destination even if the reference note retires.

The shared pitch translation is bounded by the surviving selection's minimum and
maximum pitches. Chords retain their intervals at MIDI 0 and 127, including
copies and repeat-copies. Audition publishes the same preview pitch, only when
the effective translation changes; repeated motion beyond a boundary is silent.

## Automation slope ownership and loop diagnostics

Slope movement starts at the pointer-down Y coordinate, so even a single move
contributes its full distance; Alt precision scales each movement increment.
The gesture owns one attached reference/successor segment. Editing either point
retires it, including an edit that restores its original value. Membership and
immediate-successor identity are checked for preview, movement and approval.
Insertion, deletion, reparenting or collection retirement cancels stale approval;
current interpolation is shown instead. Owned subscriptions end on all exits.

Loop-duration approval emits no console diagnostic snapshots. It performs only
the actual resize/overlap work; unrelated regions are never read or allocated
solely for before/after logging. There is no enabled debug projection to bound.

## Implementation and validation

Round 114 was implemented with Codex from a fresh checkout. Each bundle adds
synthetic regressions, runs them against the preceding implementation to confirm
the failure, and then runs them with the fix. No live audio hardware or personal
data is needed. Full local build, lint, unit and Chromium gates are recorded in
the local handoff; cross-family review is performed by the merge clerk.

## Local validation (2026-11-16)

Fresh source: `b543a2592d46523a57c511c14b5163ddf7ebb8f4`, `origin/main`,
`git@github.com:ephes/openDAW.git`. All twelve slices remain applicable.
No owner decisions were needed. Node v26.13.1 satisfies `>=23`; npm v11.20.0.
No version changes, remote branches, pushes, merges or deployments were made.

Regression failures were confirmed before each bundle's production changes:

| Bundle | Regression coverage |
| --- | --- |
| B01 | Nearest marker in both insertion orders, stable ties, fractional neighbors |
| B02 | Current neighbor insertion/movement/deletion, insufficient spacing, cancellation, retirement and external updates |
| B03 | Duplicate/reversed/nonfinite warp geometry, unavailable conversion/capture, current transient membership and insertion refusal |
| B04 | Original surviving identities, move/copy/repeat-copy, low/high chords, MIDI audition domain and boundary notification suppression |
| B05 | First motion vs subdivided motion, current endpoint/successor ownership and interpolation generation, unrelated-region diagnostic reads |

A further painter regression confirmed copy origins and previews after selection
replacement. Shared Chromium/DOM graph fixtures exercise actual BoxEditing undo,
separate curve-box edits (including restore-to-original edits), inserted successors,
and real Dragging pointer-up, pointercancel, Escape and disposal hooks.

Passed gates:

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
npm test --workspace=@opendaw/app-studio -- src/ui/timeline
npx tsc --noEmit -p packages/app/studio
```

The targeted timeline run passes 57 tests in eight files. Lint passes with the
repository's existing warning policy. Browser fixtures are typechecked through
the shared graph regression and checked by `lint:browser`.

Browser gate:

```sh
npm run test:browser -- r114.spec.ts
```

The implementation sandbox could not start Chromium (macOS MachPortRendezvous
`bootstrap_check_in ... Permission denied (1100)`). The merge run outside the
sandbox passes all seven Chromium scenarios in `r114.spec.ts`. In the same full
browser run, `scripts.spec.ts` fails with an unregistered `script-contracts`
worklet; it fails identically on the unchanged main branch and is unrelated.
Full gate and before/after logs are retained outside the clone in
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r114-opendaw/`.
