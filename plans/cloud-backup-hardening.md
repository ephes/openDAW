# Cloud backup boundary fixes

Changes use coding assistance with isolated Claude review before integration.
Synthetic storage/provider fixtures cover real entry points and controlled failures;
no user files, real cloud logins or deployment operations are involved.

Physical inventory regressions cover both sample and soundfont storage and backup
callers. Strict backup inventory rejects unreadable or misidentified assets before
side effects, while tolerant browsing preserves recovery bytes.

Catalog/journal regressions use complete synthetic metadata and inject failures at
the production backup entry points, asserting no domain mutations or asset restores.

Provider deletion tests drive the actual handlers with synthetic SDK/fetch responses,
including a completed delete followed by failed catalog publication and retry.
