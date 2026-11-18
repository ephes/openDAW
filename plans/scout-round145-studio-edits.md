# Round 145 studio editing

The fresh `origin/main` base was `de1de2d09ec38f8f455aca2da232e77c428c0d13`.
Each slice reproduced its failure in the owning package suite before the fix.

| Bundle | Regression coverage |
| --- | --- |
| B01 | The adapter suite selects and deselects real vertices. The Studio suite drags both fade handles through overlap and verifies the graph values, cancellation, undo and graph serialization. The Chromium fixture exercises marquee shrinking and Shift cancellation. |
| B02 | The Studio suite sends text drafts, arrow events and composition events to the numeric control backed by a graph field. The Chromium fixture types into the waveform offset control in the audio editor header and exercises the decimal keys, caret and commit. |
| B03 | The Studio suite edits real note boxes through the property table. It tests malformed text, overflow, signed storage boundaries, graph serialization, blur, selection changes and undo. The Chromium fixture supplies actual Tab and outside-click focus transitions. |
| B04 | The core suite uses real regions, warp markers, tempo automation and playback loop coordinates to check arrangement extent, source phase, undo and reopen. The Studio suite runs the real selector and graph conversions with deferred synthetic transient detection. |

No Warp keeps the arrangement end of a trimmed or repeated region at the current
tempo. The warp markers define the native loop span and source phase. A full
untrimmed pass still adopts the native source span. These tests verify the source
sample boundaries through the playback loop coordinates and tempo map.

Run the package build before the test suites so the fixtures pick up the current
workspace packages.

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
npx playwright install chromium
npm run test:browser
```

In the worker sandbox, Chromium launches failed with macOS Mach bootstrap
permission denial (`bootstrap_check_in`, error 1100). Browser assertions require
a run outside that sandbox.
