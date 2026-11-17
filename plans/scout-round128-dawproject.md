# DAWproject round 128

Codex implementation from the scout's pinned source findings. Changes are split
by bundle on one local branch. Regressions run first against the preceding code,
then against each fix. Test and gate logs live outside the checkout. No deployment
or remote publication is part of this work.

B01: use actual loop playback coordinates. The current engine does not consume
NoteRegionBox.eventOffset; refuse nonzero values rather than invent semantics.

B02: add backward-compatible enabled send state and honor it in the audio path.
Channel solo uses the schema boolean attribute; mute uses BooleanParameterSchema.

B03: preflight owned content before any packer writes. Retain the existing
tempo/signature paths and arrangement-only projects.

B04: reject unsupported expressive state before packing; admit linear zero-gain
audio envelopes and serialize their PPQN extents as beats.

B05: rebind native device hosts while decoding via DeviceIO, validate in a
temporary graph and refuse dependent state/external pointers explicitly. Preserve
standalone instrument/effect parameters and order. Buses are structural channels.
Generic Points admission is separate from dedicated tempo/signature support.

B06: refuse explicit source playStop windows and apply supported beat-based audio
fades. Check actual envelope edge gains after export/import; invalid fade
extents/units fail before graph construction and sample lookup.

## Validation and local handoff

Fresh SSH clone of `ephes/openDAW`, default branch `main` at
`e2ba9958`; all twelve source findings were still applicable. One local branch:
`codex-q/r128-openDAW`. No push, merge, release or review-agent invocation.

Each bundle has regressions observed failing before its fix and passing after it.
The final DAWproject subset passes 95 tests across 9 files; the auxiliary-send
processor regression also passes. The native round trip uses a nondefault Nano
and an ordered Fold/Delay chain, verifies parameters and destination pointers,
and refuses malformed/dependent state. Extra regressions close native bus-role
and nested generic Points omissions. XML nonfinite-number admission was already
present and is retained, separately from new finite fade-extent validation.

Passed locally:

- `npm ci --ignore-scripts`
- `npm run build` (24 successful tasks)
- `npm run lint` (24 successful tasks plus browser fixture lint; existing warnings)
- `npm test` (44 successful tasks; core: 927 tests, processors: 315 tests)
- `npx tsc -p packages/studio/core/tsconfig.test.json --noEmit`
- `git diff --check`

Supplemental Chromium selection/import fixture gate blocked at browser launch:

```sh
npm run test:browser -- tests/browser/scout99.spec.ts --output=/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r128-opendaw/browser-results
```

Both tests fail to launch Chromium in the sandbox with
`bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`;
no browser assertion ran. The merge clerk must rerun that command outside the
sandbox. Logs and browser failure artifacts are in
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r128-opendaw/`.
No owner decision is required. Nonzero event offsets, explicit playStop windows
and unsafe/dependent native states use the brief's allowed refusal paths.
