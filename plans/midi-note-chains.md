# MIDI note chains

## Groove and live input

Zeitgeist borrows groove adapters from the registry; it owns its pointer
subscription only. Switching a groove or terminating an effect must leave other
users of that adapter subscribed. Active-note projections warp both endpoints;
infinite held-note durations stay infinite. Zeitgeist, Pitch and Velocity
project active notes as fresh copies, so retained upstream notes are never changed in place. Lifecycle events retain their IDs.

Active-note enumeration carries optional `external` provenance for keyboard and
audition notes. Pitch, Velocity and Zeitgeist preserve it, and Arpeggio copies the
selected note's provenance to its retained generated note. Stopped chains expose
only external retained notes, including in a second arpeggio; timeline notes stay
excluded. Missing provenance means sequenced input.

## Implementation and validation

The round 85 B01 implementation used Codex to inspect the real graph/adapter and
processor paths and add synthetic processor-chain regressions. Each defect was
reproduced against the original source before applying the fix. Tests exercise
shared groove replacement/retirement, nonlinear endpoints across render windows,
identity and infinite durations, repeated queries of retained upstream notes, and nested live input with timeline exclusion.
Run the root build, lint and test commands documented in README.md.
