# Round 139 DAWproject interchange

Implemented with Codex using synthetic XML and in-memory native graphs. No external
project data or services are involved. Changes follow B01 through B06 in order;
regressions are first run against the preceding implementation.

## B01: real tempo units

Import literal 120/400 BPM and check stored values, independent beat/second
expectations through TempoGridCursor, positions and display-range independence.
Export independently authored native 120/180 BPM events. Invalid native float32
BPM refuses before graph construction/packing. All six regressions failed before
the fix and pass after it.

Validation: locked `npm ci --ignore-scripts`; `npm run build`, `npm run lint`,
`npm test`. The browser command `npm run test:browser -- tests/browser/scout99.spec.ts`
cannot launch Chromium in this macOS sandbox: MachPortRendezvousServer
`bootstrap_check_in` returns Permission denied (1100). The outside merge clerk must
run browser validation. Full command outputs and red/green regressions are in the
worker's external coordination log directory, not the repository.

## B02: route accounting

Regressions expose dropped primary sends, accepted missing/wrong-kind outputs and
send targets, and feedback. Preserve an intentionally unrouted channel and a
forward-referenced aux; check send values and native export/reimport. Six tests
failed before the fix; the absent-output positive case already passed.
The same build/lint/test and browser commands are run after this bundle.

The older EQ archive fixture declares a disabled aux self-send. Its test now
asserts feedback refusal, then removes that send to retain the ordinary EQ import
smoke check. Disabled/zero-gain cyclic declarations are refused too because edits
could activate the unsupported topology.

## B03: child tracks and instrument kinds

Before the fix, regular/effect children failed track resolution; master children
already worked. Independent self-contained MIDIOutput/Apparat/Soundfont presets
imported with Undefined track type. Tests now check the full subtree, notes and
pointers and native factory track-type agreement in import and export. Existing
dependent-resource refusal regressions remain in the full suite.
The same build/lint/test and browser commands are run after this bundle.

## B04: lane traversal and clip references

Compare flat and three-level arrangement lanes, inherited/explicit track identities
and note positions. Unknown nested tracks refuse during preflight. Choose the
scout's bounded early-refusal option for clip references, including shared notes,
duplicate IDs, dangling and cyclic declarations. Clip-contained lanes also refuse
instead of disappearing. All seven new cases fail against B03.
The same build/lint/test and browser commands are run after this bundle.

## B05: explicit coordinate admission

Regressions cover nested placement/trim/loop/duration/mute transforms, a positive
transparent wrapper, missing/malformed/nonfinite/negative/overflow/sub-pulse times,
and independent zero/fractional tempo and signature positions. Signature timing
is native bar-relative, so non-bar changes refuse instead of snapping to a later
bar. All Point XML subtypes share required finite numeric conversion.
The new failure cases were run red before implementation; positive wrapper and
valid timing cases retain their prior behavior. The same full gates follow.

## B06: arrangement markers

Correct the typed marker container. Import two labeled/colors markers, check native
save/reopen and reject unsupported coordinates, seconds, comments and colors.
Independently create native markers and inspect literal XML; repeat counts and
disabled nonempty tracks refuse before the first packer write. Markerless export
remains supported. All new failure cases were run before the fix. Native hue
colors are intentionally restricted to the exact representable palette.

The synthetic Chromium fixture `tests/browser/r139.spec.ts` combines child tracks,
nested lanes/wrappers, primary sends, literal BPM playback timing, markers, native
save/reopen and export/reimport. It also checks early refusal without resource
reads. Run `npm run test:browser -- tests/browser/scout99.spec.ts tests/browser/r139.spec.ts`
outside the sandbox; the same Chromium Mach-port denial prevents execution here.

An additional red regression found that integer pulse 31 (and 123) can return a
small binary floating residue after beat serialization. Admission now rounds only
within two relative machine epsilons, preserving native pulse positions while
continuing to refuse actual sub-pulse coordinates, including tiny positive times.
Final local validation passes locked installation, full build, lint and tests;
Chromium remains blocked by sandbox Mach-port registration. Browser fixture lint
and standalone TypeScript checks also pass. The outside clerk owns browser
execution and cross-family review; no subscription review agent was run here.

## Merge review amendments

Review of the merged bundle reversed four refusals that blocked real projects:

- The EQ fixture is an unmodified Bitwig Studio export. Bitwig writes a disabled,
  zero-gain send slot from every channel to every FX/return channel (including
  itself), so refusing it blocked every Bitwig project with return tracks. Enabled
  routes must still be acyclic; a disabled send that would close a cycle is now
  dropped in document order, other disabled sends import disabled.
- Bitwig writes beat times with six decimals. Admission now tolerates half a
  microbeat around a pulse (triplets such as `0.333333`) and still refuses real
  sub-pulse offsets and positive times collapsing to zero.
- Marker colors outside the native palette map to the nearest hue, like clip
  colors, instead of refusing the whole project.
- A disabled marker track only suspends marker playback actions, so its markers
  export. Repeat play counts still refuse.
- Export writes Arrangement children in DAWproject schema order.
- A transparent wrapper's inner source may end up to 1.5 microbeats short of the
  outer window end (float sums and independent six-decimal rounding).
