# Round 107 processor lifecycle

Fresh base: `ab95c07113d0b5a315f4b42088591efee12633b7` (`origin/main`).
All twelve scout findings remain applicable. Work proceeds B01 through B06.
Implementation uses synthetic Vitest collaborators and actual scheduling/DSP code;
no personal data or external playback services. Codex assisted implementation;
regressions are run against the old code before each fix, then the corrected code.

B01: `ChainRetirement.test.ts` fails for both chain kinds before cleanup ownership
is added (missing device disposal / retained enabled subscription). Both pass
afterwards, including repeated termination, zero edges and zero connections.

B02: graph disposal, queued deletion notifications and a 2000-track churn probe
all fail before the fix. Disposal occurs once; later deletion visits one live state.

B03: five failing cases cover replacement/stop cancellation, first-boundary
play/stop partition parity and right-endpoint ownership. All pass after the fix.

B04: twelve failing cases cover three-beat one-shots launched at beat four across
three partitions, invalid initial/edited durations and explicit repaired relaunch.
Natural ending also applies to the remainder of the launch span.

B05: deterministic Atomics interception publishes a new start between counters and
timestamps; the old reader accepts a mixed pair. A worker-source fixture executes
two iterations and checks the odd write fence. Negative counters and both signed
rollover pairs fail before the modular comparison fix. No busy waiting is added.
