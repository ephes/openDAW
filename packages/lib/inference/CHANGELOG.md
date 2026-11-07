# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## Unreleased

- Stem outputs outside the documented one-stacked/four-separate tensor layouts now reject, including extra output names or alternate ranks.

- Validate planar stem inputs, chunk planning arguments and exact output tensor storage/shapes.

- Verify actual cached model content and bound model downloads by bytes and total duration.

- Cancellation contract: preserve AbortSignal.reason (including default AbortError); deprecate InferenceCancelledError. Abort shared downloads when their last waiter cancels; release after a failed load is a no-op.

- Share task loads, serialize disposal with session work, and fence cancelled inference results/progress.

- Settle synchronous queue failures, retire failed worker generations, permit startup retries, and make shutdown terminal for owned work.

- Restore baseline lint with explicit boundary types and behavior-preserving source cleanup.

## [0.0.4](https://github.com/andremichelle/openDAW/compare/@opendaw/lib-inference@0.0.3...@opendaw/lib-inference@0.0.4) (2026-05-22)

**Note:** Version bump only for package @opendaw/lib-inference

## [0.0.3](https://github.com/andremichelle/openDAW/compare/@opendaw/lib-inference@0.0.2...@opendaw/lib-inference@0.0.3) (2026-05-14)

**Note:** Version bump only for package @opendaw/lib-inference

## 0.0.2 (2026-05-13)

**Note:** Version bump only for package @opendaw/lib-inference
