# Project bundle library preservation

Round 63 B10 with coding assistance: required-entry/metadata/project preflight, staged
migration reads, canonical complete asset validation, existing-media protection under
standard storage locks, metadata-last publication and owned rollback. Use existing
ProjectSkeleton/ProjectMigration/Project.fromSkeleton APIs so async migration never
reenters a held lock. Tests use real ZIP, WAV and peaks fixtures plus fake OPFS and
project construction. No cloud, audio devices, deployment or real user content.
Run focused core tests and root build/lint/tests.

Reverification: main already supplies the shared soundfont save lock through the concurrent authoritative-inventory change. Reuse it. The shared WAV decoder also needs chunk/geometry validation before allocation to make untrusted staged audio preflight bounded; four synthetic malformed headers fail before the guard without making large allocations. Invalid asset metadata identities reject before publication.

Migration staging never falls through to global sample loading, because that can publish cache/repair writes before an import fails. A regression demonstrates the previously unowned write and now rejects missing staged migration input before calling that loader.

Metadata validation follows the actual ProjectMeta string timestamp contract, retaining legacy string values instead of introducing a new ISO-only requirement. A synthetic compatibility test failed under the overly strict intermediate schema.

Review dispositions: retain the report-mandated rejection of conflicting bytes and incomplete existing assets. A synthetic same-source/same-UUID WAV re-encode at 48 kHz rejects while keeping the 44.1 kHz local bytes. Missing/corrupt peaks and invalid metadata remain unchanged, report actionable repair errors, and import succeeds after explicit external repair. Calling SampleStorage.load to auto-repair here would violate the owner's preservation boundary.

Accepted suggestions: tolerate bounded partial final WAV frames and truncated trailing ancillary chunks while rejecting oversized fmt/data chunks before allocation. Preflight releases decoded validation data and caches loaded loaders lazily only for migration requests, then clears them before publication. Expanded bytes still stage in memory under the 1 GiB ceiling; large legacy migrations can retain additional decoded audio.

Second review found an editing mistake that replaced the core README with source. Restored the entire HEAD README, retaining all existing sections, and appended only the final bundle preservation/compatibility/memory documentation. Verified the diff contains additions only.
