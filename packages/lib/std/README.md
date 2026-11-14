_This package is part of the openDAW SDK_

# @opendaw/lib-std

Standard library providing core utilities and data structures for TypeScript projects.

## Core Utilities

* Language primitives, type definitions, and utility functions **lang.ts**
* Optional values with monadic operations **option.ts**
* UUID generation, parsing, and manipulation **uuid.ts**
* Array utilities and operations **arrays.ts**
* Object manipulation and utility functions **objects.ts**
* String processing and utilities **strings.ts**
* Mathematical operations and utilities **math.ts**
* Numeric type handling and operations **numeric.ts**

## Data Structures

* Ordered set with custom key extraction and comparison **sorted-set.ts**
* Multi-value map implementation **multimap.ts**
* Bidirectional mapping data structure **bijective.ts**
* Caching mechanisms **cache.ts**
* Map utilities and extensions **maps.ts**
* Set utilities and operations **sets.ts**

`SortedSet.addMany` uses comparator equality, including UUID byte keys. Existing
entries win over incoming duplicates; among incoming duplicates the first wins,
as with repeated `add` calls. It returns false if any duplicate was encountered.
Iteration, key extraction, sorting and deduplication finish before publication;
if any throws, the set remains unchanged. `values()` is a read-only view of the
current backing array; bulk publication can replace that array.

`SortedSet.getOrCreate` rechecks the requested key after calling the factory. If
the factory installed that key reentrantly, that installed entry wins and is
returned. Factories must produce the requested key. Unused factory results are
not automatically disposed; a factory allocating resources must retain ownership
until it can check whether its result was returned.

`ArrayMultimap.clone` retains its value comparator and stable order of equal
values. Bucket arrays are independent; the value objects themselves are shared.
`addAll` stages the complete bucket without argument spread, so large iterables
are supported and iterator/comparator failures preserve the original bucket and
key order. Successful bulk updates can replace the bucket returned by `get`.
`sortKeys` publishes a fully sorted map without replaying value insertion; key
comparator failures preserve the original map. `BinarySearch.stableInsert` finds
the upper bound in logarithmic comparisons, even for a run of equal values.

## Algorithms & Search

* Binary search implementations **binary-search.ts**
* Comparison function utilities **comparators.ts**
* Hashing utilities **hash.ts**
* Predicate functions and utilities **predicates.ts**

## Data Processing

* Data input/output operations **data.ts**
* Schema validation and utilities **schema.ts**
* Cryptographic utilities **crypto.ts**
* Bit manipulation operations **bits.ts**

## Collections & Iteration

* Iterable utilities and operations **iterables.ts**
* Generator functions and utilities **generators.ts**
* Interval operations and utilities **intervals.ts**
* Range implementations **range.ts**
* Selection utilities **SelectionBox.ts**

## Async & Reactive

* Observer pattern implementations **observers.ts**
* Event listener utilities **listeners.ts**
* Terminable resource management **terminable.ts**
* Synchronous stream operations **sync-stream.ts**
* Retry and attempt utilities **attempts.ts**

Default, optional and mapped mutable observables register a catchup subscription
before its initial delivery, so synchronous changes from that callback are
observed. Failed initial delivery releases the subscription and rethrows the
original error. `MutableObservableOption.clear` detaches the old value, notifies
the empty transition, then calls the disposal procedure with the old value.
Reentrant replacement survives; disposal runs even if notification throws. If
both notification and disposal fail, the notification error remains primary.

## Specialized

* Geometric operations and utilities **geom.ts**
* Color manipulation and utilities **color.ts**
* Curve mathematics and operations **curve.ts**
* Time span calculations **time-span.ts**
* Progress tracking utilities **progress.ts**
* Parameter handling utilities **parameters.ts**
* TypeScript decorators **decorators.ts**
* Random number generation **random.ts**
* Value guidance systems **value-guides.ts**
* Value mapping utilities **value-mapping.ts**
* String mapping operations **string-mapping.ts**

UUID parsing accepts either exactly 32 hexadecimal digits or the canonical 8-4-4-4-12
groups, case insensitively. Binary strings use nonnegative UTF-16 code-unit lengths;
the complete byte requirement is checked before reading any characters.

Binary output is relative to the supplied buffer offset, including shared buffers and
auto-growth. ByteCounter includes the four-byte string length plus two bytes per
UTF-16 code unit. Checksum retains every encoded bigint/Float64 byte; it remains
a lightweight, non-cryptographic checksum. Affected historical checksums change.

SyncStream writers require the buffer returned by `SyncStream.reader`; arbitrary
zero-filled buffers are not initialized streams. SyncStream starts empty and grants one writer or reader exclusive ownership.
Failed writes are discarded; failed reads/consumers release their frame. Errors
propagate unchanged, and subsequent exchanges remain possible. Constructing another
writer does not reset ownership. Schema float/double arrays have fixed type and
length on read and write; matching replacements and in-place updates are supported.

ValueMapping.values requires a nonempty list; a singleton has normalized coordinate
zero and always maps back to its sole value. LinearInteger bounds must increase
after rounding and signed-integer clamping. Continuous mapping tests cover inverse
grids, analytic midpoints, clamping and DefaultDecibel silence/-12 dB center.
ObjectPool tests enforce exclusive live identities, counter conservation and
error-safe foreign/double release, without prescribing a growth batch size.
Run `npm test --workspace=@opendaw/lib-std` after the root build.

RuntimeSignal tests isolate the real process-global module and verify idempotent
unsubscription, surviving consumers and synchronous nested/self-removing delivery.
TimeSpan tests control performance.now for progress estimates, unit carries,
negative/past semantics and explicit NaN/infinity formatting. Compact strings retain
their existing unsigned wording (including singular zero units); relative strings
use explicit English past/future wording. No wall-clock waits or locale defaults
are used.
