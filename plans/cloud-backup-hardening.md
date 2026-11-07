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

Project generation tests inject failures at each upload and catalog publication,
then restore afresh. Fake time/deferred transports test timeout, retry and lock ownership.

Local revision tests interleave real ProjectProfile saves with backup snapshot reads
and deferred network uploads. Preset tests compare newer/equal/older timestamps and
assert that catalog replacement follows successful byte upload.

Preset batch/catalog failure tests make the in-place partial-update limitation explicit
and verify a later successful retry repairs metadata. Coherent preset-pair capture is
deferred beyond timestamp resynchronization; documentation avoids claiming it.

Asset publication regressions use a generated valid synthetic RIFF/SF2 and test-owned
WAV/peaks, deferred writes, same-UUID writers and controlled delete/edit interleavings.

Fresh validated soundfont input repairs incomplete existing UUIDs without granting
whole-directory cleanup ownership. Actual stock-loader retry and re-import tests cover
recovery; operational reads still fail closed. Sample edit UI tests execute the real
icon handler and verify refresh/feedback instead of an unhandled stale-target error.

OAuth regressions execute the actual callback HTML and manager with synthetic state,
popups, channels and provider responses. The three input/correlation/privacy slices
exclude pre-callback popup closure detection, which requires an isolation/header design
beyond the existing cross-origin opener proxy.
