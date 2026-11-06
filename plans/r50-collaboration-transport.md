# Collaboration transport

Scout round 50 W3, independently branched from the current main. All four findings were present.
Production HTTPS setup delegates to a small transport attachment function so tests can exercise the same upgrade and
message paths over certificate-free ephemeral loopback sockets. Existing public ws/lib0 APIs provide limits, buffering
and per-document debounce; no scheduler or service was added. Tests use synthetic peers and documents. An assistant
helped implement the changes; the configured Opus 5.5 high review is attempted separately.

Validation: 21 Node transport tests, root tests, full build and production JS syntax checks pass. Targeted server ESLint
passes with two existing unused-parameter warnings; obsolete type-suppression comments were removed. Eleven regressions
fail with the original transport behavior, including both upgrade routes. Root lint remains red on main across many
workspaces and cannot be repaired in a small prerequisite slice without suppressions. The mandatory Opus 5.5 high review
returned PROVIDER_ERROR: OAuth session expired and could not be refreshed. No verdict; not approved for merge.
