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
