_This package is part of the openDAW SDK_

# @opendaw/lib-fusion

Web-based audio workstation fusion utilities for TypeScript projects.

## File System Operations

* **OpfsWorker.ts** - Origin Private File System worker implementation
* **OpfsProtocol.ts** - OPFS communication protocol definitions

## Audio Visualization

* **Peaks.ts** - Audio peak data management and processing
* **PeakWorker.ts** - Web Worker for peak generation
* **PeakProtocol.ts** - Peak data communication protocol
* **PeaksPainter.ts** - Canvas-based peak visualization rendering

## Live Audio Streaming

* **live-stream/** - Directory containing live audio stream processing utilities

## Core Types

* **types.ts** - Type definitions for fusion operations

OPFS writes accept `Uint8Array` subviews and store only the supplied byte range, including empty views.
Reads and writes complete short transfers using explicit offsets and reject zero progress; handles always close.
`exists` treats empty files as absent. Missing entries normalize to `false`/an empty listing/a no-op deletion;
permission, access-state and other operational errors reject through the protocol.
