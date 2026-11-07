# XML import contracts (round 59)

Bundle the workspace-test-command, document-and-root-validation,
finite-numeric-attributes and boolean-lexical-contract slices. Use the existing
Vitest/jsdom setup, schema metadata and public parser APIs; no new dependency,
publishing or deployment step is needed.

The new production-parser regressions fail against the starting implementation.
They cover malformed/wrong roots, finite number admission, explicit boolean
literals, optional absence, namespace/declaration compatibility, inheritance and
serialization round trips. The old workspace command succeeds without executing
these failing tests; a temporary existing-expectation mutation verifies that the
wired focused and root commands both fail, followed by restoration and full checks.

Implementation uses Codex with local regression runs and a separate Claude review
of this bundle before merge. No versions or release tags change.

Browser marker handling follows the public DOM API and the diagnostic element
placement in [Chromium's XML error implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/xml/parser/xml_errors.cc).

Review returned Suggestions only. Retain existing finite Number() lexical forms
rather than introduce an additional compatibility break; document base-prefixed
forms and test them alongside direct exponent-literal imports.
