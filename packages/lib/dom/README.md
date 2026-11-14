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
