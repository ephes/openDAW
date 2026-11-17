# Round 123: ownership and input admission

Changes are implemented sequentially from fresh main, with synthetic regression
tests written and run against the original behavior before each fix. Instrumented
audio nodes count owned and foreign connections and inject construction, connect
and map-publication failures. Full build, lint, tests and Chromium fixtures run
locally; no remote publication or real user data is involved.
