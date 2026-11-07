# Scoped dependency patches

Verified the four round-69 dependency findings against current main. Refreshed
only the six requested resolutions, with a Monaco-scoped DOMPurify override.
Implementation used source inspection, synthetic Vitest fixtures, local npm audit,
and build/lint/test checks; a separate Claude review gates the merge. No model
assets, releases, deployments or workflow changes are part of this change.

Final integration inspection found Monaco also vendors DOMPurify in its ESM tree.
The override alone does not affect that bundled copy. An exact Vite import alias
uses the public patched package export; a regression inspects the built editor
bundle for the patched version and absence of the old sanitizer.
