# Shared async primitive repairs

Scope: retry policy ownership, promise-limit slot release, memoization rejection races,
and progress-stream backpressure/cancellation. Implementation was assisted by Codex;
independent review uses the Claude review harness. All fixtures are synthetic and use
fake timers, deferred promises and standard Web Streams without network access.

Regression tests were run before the changes: nine failed. The repaired runtime suite
passes, as does its test TypeScript configuration. Workspace lint currently encounters
pre-existing configuration/rule failures; the separate baseline-lint worker owns those.
Package README and Unreleased notes describe the resulting ownership contracts.
