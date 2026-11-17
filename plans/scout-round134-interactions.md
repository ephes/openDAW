# Round 134 interaction contracts

Implementation process: Codex checked a fresh `main` clone against the scout,
added regressions against production components with synthetic boundaries, ran
those regressions before changing each affected implementation, then applied
small local repairs. No external service or personal data is involved. The
outside merge clerk owns cross-family review and integration.

## Menus (B01)

Menus use `performance.now()` for the existing 250 ms release guard. Each child
menu starts its own guard. Only a primary-button release may prevent the event,
close the menu and invoke a command; secondary/middle releases leave it open.
Context-menu opening remains available. `Menu.test.ts` independently controls
wall and elapsed clocks and invokes the installed handlers.

## Validation

From the repository root: `npm ci --ignore-scripts`, `npm run build`,
`npm run lint`, `npm test`, `npm run test:browser` (Chromium installed).
Targeted red/green receipts and full-gate logs live in the worker log directory,
not in this repository. Browser fixtures use synthetic projects and MIDI ports.

## Menu population and canvas frames (B02)

Failed menu collection discards only children appended by that attempt and
restores the previous collection state in `finally`. Permanent children and
later successful openings remain usable. `MenuItems.test.ts` covers both
collector and runtime-procedure failures.

Canvas rendering consumes the current dirty bit before calling the painter.
Invalidations raised during drawing survive for the next frame. Each existing
frame callback checks DPR before returning idle: a density-only change resizes
and draws once. Hidden canvases retain work and retirement stops frames.
`painter.test.ts` uses recording frame/resize/context seams, including resize,
reentrant requests, hidden canvases and teardown.
