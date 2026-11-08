This package is part of the openDAW SDK
### Cloud backup recovery

Backup holds a browser Web Lock per provider for the whole lifecycle (including lock
release). Accounts using the same provider are conservatively serialized. The remote
lock still warns about other browsers; it is not an atomic cross-device mutex. Failed
lock uploads never confer release ownership. Release failures always close progress;
a primary backup failure is preserved and a separate safe warning identifies a stale
lock. Coordinate with other users before ignoring a stale remote lock on retry.

Drive folder failures release the retry latch. Retrying looks up each folder again,
including a folder whose creation succeeded but whose response was lost. Dropbox
listings follow all continuation pages; any page failure rejects the whole listing.

### Recording completion and monitoring

Recording finalization owns one import and one successful saved notification. Failed
imports publish a terminal error, stop owned capture resources, and retain in-memory
audio on the loader for deliberate recovery; reload does not persist that recovery
buffer. Late subscribers receive terminal errors immediately. A monitor sink or play
failure clears the custom destination and reconnects monitoring to the default output.

### Capture diagnostic privacy

The core CaptureAudio diagnostics include only numeric latency/channel values and
fixed fallback/error categories. This capture path and the core AudioDevices stream
request helper omit device IDs, labels and raw getUserMedia/sink errors from their
diagnostics. This is a boundary for these audio-capture paths, not a claim that all
other MIDI or app output-device diagnostic sources have been sanitized. The studio log attachment keeps
at most 100,000 serialized UTF-16 code units (8,000 per entry), including metadata
and JSON escaping. Recent bounded context survives; large arguments are truncated
and structured serialization has a bounded traversal.

### Soundfont loader completion

Late subscribers synchronously receive loaded or error state. Loaded subscriptions
are empty; error subscriptions stay registered so device/UI observers can see an
invalidate retry. One-shot export waiters terminate their returned subscription,
including when a terminal callback fires synchronously.
Cached and fetched library-import failures publish a bounded retryable error.
Invalidate starts a new generation; earlier storage/fetch/library continuations and
progress cannot replace the new loader's state, font or metadata or start stale
follow-up work. Project export handles synchronous terminal subscriptions safely.

Soundfont storage reads return exactly the provider Uint8Array view, including nonzero-offset views; adjacent backing bytes are excluded before SF2 parsing.

### Local inventory and backup

Browsing skips invalid asset directories or metadata and retains their bytes for
recovery. Directory UUIDs own asset identity: metadata cannot redirect that identity.
Sample and soundfont backup use strict inventories. Listing, metadata read/parse or
identity failures stop the domain before uploads, restores or deletion. A genuinely
missing first-run directory is empty; inaccessible existing storage is an error.
Strict scans hold the same domain Web Lock as saves/deletes, so they wait for
in-progress publication. A failure aborts the entire backup run, including later
domains; earlier completed domains remain complete. The diagnostic identifies the
folder/entry to repair before retrying backup.

### Preset index consistency

Preset records validate canonical UUIDs, finite timestamps, shared fields and each
category's registered instrument/effect key. Invalid records trigger recovery that preserves other valid metadata and merges
physical recognized rack files. Retained metadata requires a matching physical file;
missing-file records are removed by rebuild and unrecognized files remain untouched. Unsupported
cloud records are skipped during download without rewriting the remote catalog. Index mutations and
explicit rebuilds hold the standard browser storage Web Lock, reread committed
state, and update the observable only after the index write. Save validates/rebuilds
the index before writing its new file; file, index and trash ordering remains explicit.
Public reads refresh committed state under the lock; mutations never trust another tab's old cache.

### Catalog preflight and deletion journals

Cloud backup validates each domain's complete remote catalog before its upload,
trash and restore phases. Catalogs require unique UUIDs and their domain metadata;
project dates and preset timestamps must be finite. Invalid existing catalogs need
repair and are never treated as empty. Back up the catalog before repairing it: recover
metadata from its media/project files or a known-good copy, retain UUIDs and valid
unknown extension fields, and retry. There is no automatic corruption migration.
Local candidates use the same schema before any domain effects, so invalid local
metadata cannot poison a previously valid remote catalog. Opaque nonempty preset
device keys and unknown extension fields round-trip for compatibility. Only a provider-confirmed missing catalog
starts empty. Only an actually missing trash journal means no tombstones; other
read failures and invalid UUID lists stop the domain to preserve deletion intent.

Preset save/remove/update operations share a storage lock. Save and remove validate
deletion intent before changing files; remove persists its tombstone before deletion.
A journal failure therefore cannot silently delete a preset without recording intent.

Cloud deletion is retryable when a catalog upload fails after deleting an object.
Dropbox ignores only its HTTP 409 path_lookup/not_found delete classification;
authentication, permissions, write errors and transport failures still abort cleanup.
Drive cleanup resolves both files and project folders, while downloads/uploads keep
their file-only target lookup. Missing targets are no-ops; other errors propagate.

### Project generations and upload deadlines

New project backups upload to immutable `projects/<uuid>/generations/<generation>/`
directories. The catalog publishes that generation only after project, metadata and
optional cover uploads succeed. Failure (including catalog publication) leaves the
previous referenced generation intact. Restore follows the catalog reference; entries
without a generation continue to use the legacy `projects/<uuid>/` layout. A missing
referenced generation is corruption, never a reason to mix in legacy files. Failed
or superseded generations are retained; there is no automatic garbage collection.
Explicit project deletion removes its entire project directory.

A ten-minute per-project attempt deadline aborts supported provider requests and stops
scheduling later files. The attempt still owns the backup until an already-started
upload settles, even if a custom transport ignores abort. Retry/Cancel is offered only
then; retries use new generations and never overlap prior work. This can wait beyond
the deadline on a non-cooperative transport, protecting ownership over prompt timeout.

Generation compatibility is one-way: updated clients restore legacy catalogs, but
older clients do not understand generation references. Before the first generation
backup, close old studio tabs and update every device used with this cloud account.
An older client may restore stale legacy bytes or offer to delete a new project as
corrupt; never approve that deletion. Use an updated client for restore/cleanup.
Each successful modified-project backup and abandoned attempt consumes another full
project copy in provider storage. Quota usage grows until deliberate owner cleanup;
this change intentionally adds no automatic generation deletion.

### Bundle import preservation

Bundle import preflights required version/UUID/project/metadata and decodes the
project structure before publishing assets. Timestamp fields retain ProjectMeta's
string contract, including legacy strings. Canonical complete sample/soundfont
entries, optional metadata UUID identity and shared ZIP entry/expanded-byte budgets
are validated before writes. WAV fmt/data lengths and channel geometry validate
before decoded allocation; complete final frames and readable audio before truncated
ancillary trailers remain compatible.

Migration reads bundled samples through existing loaded loaders. Missing migration
samples reject without starting a global loader or cache/repair writes. Migration
holds no storage lock. Decoded validation data is released; only samples requested
by migration retain loaded loaders, cleared after migration. Expanded entries still
stage in memory within the shared 1 GiB ceiling; legacy migrations can retain extra
decoded audio.

Under sample-then-soundfont storage locks, import checks all existing assets before
publication, preserves complete assets with matching media (including local metadata),
and rejects conflicting bytes or incomplete/invalid existing assets. Same UUID with
different WAV bytes rejects even if another browser resampled/re-encoded the same
source differently. This conservative rule preserves the existing project's media;
use a new asset identity or resolve the conflict explicitly. Missing/corrupt peaks or
invalid metadata require explicit library repair before retry; import never silently
repairs or replaces existing files. Soundfont saves share the same storage lock.

Metadata publishes last. Synchronous project construction shares the lock scope;
later failure attempts cleanup only for newly owned folders and preserves its primary
cause if cleanup fails. Cleanup failure can leave a partial new folder requiring repair.

### Local revision capture and preset updates

Project saves and complete backup snapshots share the project storage Web Lock.
A save encodes one revision and retains ownership until all its started writes settle,
even on failure. Backup captures metadata, project and optional cover under that lock,
uses the captured metadata for catalog fields, then releases the lock before network
uploads. Operational cover-read failures stop capture. This serializes saves/capture;
it does not make a failed multi-file local save transactional.

Preset backup is local-authoritative: missing presets and existing UUIDs with a newer
validated local modification timestamp are selected for upload.
Unchanged/older local entries do not overwrite newer cloud versions. Stock presets
remain excluded; this adds no bidirectional conflict merging.

Preset files are updated in place and the batch catalog is published afterward.
If a later preset or catalog upload fails, some bytes can be newer than their catalog
metadata; another device can restore that mismatched pair until retry succeeds. Keep
the local edited presets and retry backup before restoring them elsewhere. A concurrent
local save can also change bytes after the initial index scan; this slice does not
capture a coherent preset pair or provide transactional preset generations. Successful
project generation preservation does not extend to presets.

Soundfont saves share the asset-domain Web Lock with inventory and deletion. New
media and metadata must validate; SF2 bytes finish before metadata makes the asset
visible. Repeated saves validate and preserve complete existing UUIDs. Fresh validated input can repair missing/invalid media or metadata after the old
visibility marker is retired. Operational read failures stop repair. Failure cleanup
removes a whole directory only when the current save created it; failed repairs keep
the existing directory without the new metadata marker, ready for retry. Primary
write failures survive cleanup errors. Stock fetch uses this repair path when cache reads fail (missing files or
unparseable metadata). Corrupt SF2 with readable metadata still requires fresh
re-import; loader retry alone re-reads that cache.

Sample metadata edits take the same lock as save/delete and check nonempty audio plus valid metadata
before writing, without decoding the whole WAV or regenerating peaks. A stale edit after deletion fails instead of recreating a metadata-only
asset or clearing its tombstone; an earlier completed edit can be deleted normally.

A stale sample edit refreshes the library and reports a bounded failure in the studio
instead of leaving an unhandled rejection.

### Cloud authentication callbacks

Each authorization uses random state tied to its provider and popup. Only matching
callback, error and close messages can settle it; duplicates/replays are ignored.
Provider and communication errors render as text. Authentication diagnostics omit
codes, bearer tokens and raw provider/handler errors. Dropbox retains PKCE.
Cancel in the studio if a provider popup closes before redirect: strict COOP isolation
severs its cross-origin window proxy, preventing reliable opener-side close observation.

### DAWproject import boundaries

Nested Clips supports only a single clip containing a single timeline at each level;
ambiguous multi-clip or multi-content nesting is refused before box creation.
The outer clip supplies placement and playback coordinates for this wrapper shape.
Note loops use loopEnd minus loopStart, normalize note positions to the loop window,
and preserve playback before loopStart as a separate lead-in region. Nonpositive
loops and playStart at/past loopEnd are refused. Nonlooping note clips retain their
trimmed extent without repeating. Notes beginning before a source window are omitted; note ends crossing its end are clipped.
Segments and notes shorter than one integer playback pulse are omitted; a clip
whose derived regions are all sub-pulse is refused. Admission also
checks otherwise unread arrangement lanes, and refuses empty nested wrappers.
