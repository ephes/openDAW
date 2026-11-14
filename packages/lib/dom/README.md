_This package is part of the openDAW SDK_

# @opendaw/lib-dom

DOM utilities and web browser interaction helpers for TypeScript projects.

## HTML & DOM Manipulation

* HTML element creation and manipulation utilities **html.ts**
* SVG element creation and manipulation **svg.ts**
* CSS styling utilities and helpers **css-utils.ts**

## Input & Interaction

* Event handling utilities and abstractions **events.ts**
* Keyboard input handling and key mapping **keyboard.ts**
* Drag and drop functionality **dragging.ts**
* Modifier key state management **modfier-keys.ts**

## Graphics & Canvas

* 2D canvas context utilities and helpers **context-2d.ts**

## File Operations

* File handling and manipulation utilities **files.ts**
* File compression and decompression **compression.ts**

## System & Browser

* Browser detection and compatibility utilities **browser.ts**
* Font loading and management **fonts.ts**
* Console utility commands **console-commands.ts**

## Performance & Lifecycle

* Animation frame utilities **frames.ts**
* Stream processing for DOM operations **stream.ts**
* Resource cleanup and termination handling **terminable.ts**

## Drag ownership

`Dragging.attach` owns its current process. Pointerup approves it; pointercancel,
Escape, abort, window unload and attachment disposal cancel it. Settlement retires
listeners and frame updates, releases owned capture/lock, and calls `finally`
exactly once, including when approve/cancel throws. The first failure is preserved.
Disposing an attachment is idempotent and rolls back its provisional edit before
removing the pointerdown listener.

Factory success acquires a process even if setup fails. An already-aborted signal,
failed pointer capture or throwing initial update cancels/finalizes it and removes
all subscriptions; setup failures surface through the event error path. Cleanup
also covers lost capture. Pointer-lock requests are single-flight per target,
including across attachment replacement. A late success from a settled drag is
released; the replacement can request its own lock on a subsequent move. Locks
already held by another owner are left alone.

## Frame scheduler

`AnimationFrame` dispatches an owned snapshot: one-shot callbacks run at most once,
callbacks queued during dispatch wait for the next eligible frame, and a throwing
callback is reported through `console.error` while siblings continue. Stop,
terminate or a switch of window driver retires the current dispatch immediately.
Stop preserves registered recurring and pending one-shot work; terminate clears
both. Undispatched one-shot work already in a retired snapshot is discarded.
The first callback of a new driver is accepted regardless of its timestamp; later
callbacks retain the 16 ms throttle. Cancelled callbacks cannot revive an old driver.

## Shortcut ownership

Individual shortcut subscriptions can be terminated repeatedly, before or after
context disposal. Unsubscribing removes only that registration. IME composition
never runs or records a shortcut, including bindings with `activeInTextField`.
Outside composition, global bindings leave inputs, textareas and inherited
editable content to native editing unless `activeInTextField` is explicitly set.
The composed event origin supplies text ownership inside open shadow roots;
`contenteditable="false"` regions permit normal shortcuts. Closed shadow roots
hide their origin, so their host must expose editable ownership if global
shortcuts should be suppressed.

## Validation

After the root build, `npm test --workspace=@opendaw/lib-dom` includes the drag,
frame and shortcut regressions (jsdom for DOM event tests). Run
`npx tsc -p packages/lib/dom/tsconfig.test.json` to check their types.
`npm run test:browser --workspace=@opendaw/lib-dom` exercises native Chromium
pointer capture, settlement failures and owner disposal, plus controlled
composing keyboard events, inherited editable/shadow input ownership and native
Delete editing. Install its browser once with `npx playwright install chromium`.
Pointer lock is not covered natively; jsdom regressions cover it: a drag's own
pending or granted lock supersedes capture and keeps the drag alive, and the drag
is cancelled if that lock is rejected, not granted, or ends before pointerup.
Another drag's delayed lock never shields a replacement drag.

### Fallback file picker

`Files.open` uses a hidden input when the native picker is unavailable. Change,
cancel, setup/click failure and file-list extraction failure share one terminal
path: both listeners and the input are removed before settlement. Reentrant
terminal events are ignored; errors reject the same promise and later picker
calls get a fresh input.

Run `npm test -w @opendaw/lib-dom` for synthetic DOM lifecycle regressions.
