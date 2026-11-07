# Scoped dependency patches

Verified the four round-69 dependency findings against current main. Refreshed
only the six requested resolutions, with a Monaco-scoped DOMPurify override.
Implementation used source inspection, synthetic Vitest fixtures, local npm audit,
and build/lint/test checks; a separate Claude review gates the merge. No model
assets, releases, deployments or workflow changes are part of this change.
