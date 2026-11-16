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

`Messenger.for(port)` owns the handlers it installs. Termination is idempotent
and clears a handler only while it is still owned by that wrapper, so retiring an
old owner cannot clear a replacement wrapper's handlers. Retired native wrappers
and channels drop sends and return inert subscriptions; saved native callbacks
also ignore late deliveries. Terminating a channel releases only that channel,
leaving its shared transport and other channels alive.

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

## RPC sender lifetime

Pass an existing `Terminator` (or `TerminableOwner`) as the optional third argument
to `Communicator.sender(messenger, bind, owner)` to tie requests to the caller's
lifetime. This preserves the protocol object, including protocols whose own
`terminate` method sends a remote command. Existing two-argument callers retain
their previous lifetime; callers managing shutdown should supply an owner.
The sender does not terminate the caller-owned messenger or its other consumers.

Each request reserves its ID before sending. A synchronous transport or transfer
extraction failure rejects that request, removes its pending callbacks and consumes
the ID permanently. Replies/callbacks for retired or unknown IDs are ignored.
Owner termination is idempotent, releases the receive subscription and rejects
all pending calls with `Error("Communicator sender terminated")`. New promise
dispatches reject with that error; new fire-and-forget notifications are dropped
without sending, so late callers holding a stale protocol object stay harmless.
Failed protocol binding releases the new sender while preserving the binding
error. Engine worklet and offline renderer senders use their existing terminators,
so shutdown settles outstanding engine requests.

`network.readBounded` consumes one response with a declared/actual decoded byte
ceiling and optional signal/progress callback. It accepts identity and standard
fetch-decoded gzip/deflate/Brotli, refuses other encoding declarations, checks abort before success, and cancels/unlocks the reader on failures (including
observer exceptions). Unknown lengths report zero until EOF. It does not own an
elapsed deadline; callers supply their operation's signal.

`network.defaultRetry` permits at most two retries (three attempts) for transport
TypeErrors, explicit retryable failures and HTTP 408/429/5xx. Not-found, abort,
permanent HTTP and unclassified content/validation failures are terminal.
`Promises.guardedRetry` preserves the original final rejection. Apply automatic
retry only to idempotent reads/imports; mutations require explicit user approval.
`network.withDownload` holds one of four shared FIFO permits through a complete
stock sample/preset load, including metadata, body consumption and decoding. EOF,
abort and failure release it. With an optional signal, a queued entry rejects
as soon as the signal aborts and never starts its work. `limitFetch` remains a separate headers-only helper;
do not use it alone to claim bounded concurrent body materialization.
