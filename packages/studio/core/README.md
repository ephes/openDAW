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
