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
editor disposal discard the preview without touching graph or undo history.
Each movement and approval resolves current attached marker membership and strict
neighbors, refusing intervals narrower than twice the minimum marker spacing.
Changes to the dragged marker's position or source seconds retire its proposal;
external edits survive both cancellation and approval.

## Implementation and validation

Round 114 was implemented with Codex from a fresh checkout. Each bundle adds
synthetic regressions, runs them against the preceding implementation to confirm
the failure, and then runs them with the fix. No live audio hardware or personal
data is needed. Full local build, lint, unit and Chromium gates are recorded in
the local handoff; cross-family review is performed by the merge clerk.
