_This package is part of the openDAW SDK_

# @opendaw/lib-runtime

Runtime utilities and asynchronous operations for TypeScript projects.

## Async & Promises

* **promises.ts** - Promise utilities and async operation helpers
* **wait.ts** - Waiting and delay utilities
* **runtime.ts** - Runtime environment utilities

## Network & Communication

* **fetch.ts** - HTTP request utilities and fetch wrappers
* **network.ts** - Network-related utilities
* **messenger.ts** - Message passing utilities
* **communicator.ts** - Inter-process communication helpers

## Time & Performance

* **timespan.ts** - Time span calculations and utilities
* **stopwatch.ts** - Performance timing and measurement utilities
## Async ownership and download progress

`Promises.retry` creates a fresh default policy for each operation (three total attempts).
An explicitly supplied `RetryOption` remains caller-owned; sharing an `IntervalRetryOption`
shares its attempt counter, and an exhausted policy continues to refuse retries.
`Promises.Limit` releases slots on synchronous throws and asynchronous rejection, preserving
FIFO admission and its concurrency limit. `memoizeAsync` only evicts the currently cached
promise on rejection; an expired predecessor cannot evict its replacement.

`network.progress` reads on consumer demand, forwards cancellation to the source, and releases
the reader on completion, cancellation or failure. Read and progress-handler errors fail the
wrapped body. Byte progress, status and headers are preserved; responses without a body or
with a zero content length are returned unchanged.
