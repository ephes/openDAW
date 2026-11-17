This package is part of the openDAW SDK

### Local storage read budgets

Local OPFS reads use explicit budgets before allocation: metadata, indexes and
journals 1 MiB; project/recovery graphs 64 MiB; presets 16 MiB;
sample/peak/soundfont binaries and project covers 1 GiB (covers use the media
budget because bundle import admits covers up to its 512 MiB media limit). Recovery UUID/flags admit 16/1 bytes.
Oversized files follow the existing unreadable-asset/project recovery paths.

### Soundfont import and playback

Declining the warning for imports larger than 16 MiB rejects direct `importFile`
with `AbortError` before progress, hashing, parsing or storage. Browse and missing
asset replacement treat this as cancellation without an import-error dialog.
Changing/removing a soundfont file pointer resets voices, pending note events,
note display, audio and meters before adopting its next loader. Note stops remain
processable while a font is unavailable; processor disposal also clears state.

### MIDI learning lifetime

MIDI permission completion only starts learning while the same followed user and
target parameter remain attached. Following a user again invalidates pending
permission requests. Retired projects ignore later permission completions and
cannot resume following controller changes. A target deleted during learning
cannot receive a new controller mapping.

Only one learning attempt is active at a time. Starting another closes the
previous learning dialog, and only the latest attempt can create a mapping.
A learned controller follows its box: retargeting its parameter pointer or
changing its device channel moves the live routing (and the MIDI indicator
registration) to the new parameter or channel.

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
the local edited presets and retry backup before restoring them elsewhere. Backup
captures validated preset metadata and bytes together under the storage Web Lock,
then checks upload eligibility from that captured timestamp and releases the lock
before network work. Later local edits remain eligible on the next run. This does
not provide transactional remote preset generations across files/catalogs.

Restore reacquires the preset storage lock after downloading and creates only if
metadata, physical bytes and deletion intent are still absent. A concurrent local
save or delete causes an explicit skipped-restore log; local bytes/metadata survive.
Successful new restores retain the remote metadata timestamp.

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

DAWproject arrangement timing defaults to beats. Inherited lane/clip/notes and
automation units must all be beats; seconds-based or mixed timeline timing is
refused before box creation. Warp output timing is beats, while warp source/media
coordinates are seconds (implicit source unit defaults to seconds). Export labels
warp source seconds correctly. Legacy exports labeling source seconds as beats
need correction before import; the importer does not guess.

DAWproject decode/encode console diagnostics exclude XML bodies, metadata, names,
comments and resource paths. Import warnings use fixed structural categories.

Warped audio supports strictly ordered linear mappings from (0 beats, 0 source
seconds) to the full source duration. Collinear intermediate markers are accepted;
nonlinear mappings, nonzero origins and multiple warped contents are refused before
box creation. playStart is preserved in beat playback coordinates. Audio loopStart
must be zero; loops may end earlier than the source while retaining its original
warp scale. Nonlooping clips must fit the remaining source window.

Export preserves existing warp markers and play offsets, and requires loaded audio
instead of emitting an empty warped clip.

No-stretch audio with absolute durations exports through constant-tempo beat
conversion. No-stretch audio in either time base, and all absolute audio, cannot
export with tempo automation. Any audio region with a nonzero waveform offset is
refused, including pitch/time stretch; beat positions remain beat positions.

### Software MIDI ownership

Software keyboard presses each own one release. Unmatched releases are ignored;
changing channel releases all owned presses on the previous channel. Note numbers
must be integers 0–127 and channels integers 0–15; invalid input is refused before
state changes. Held-note counts do not wrap at 256 presses.

The listener observable counts actual EventTarget registrations (type, callback and
capture), plus one slot for a non-null onmidimessage handler. Duplicate adds and
absent removals do not change it. Once dispatch and AbortSignal cancellation retire
the registration; replacing the property handler retains one slot.

### Timeline overlap modes

Keep-existing leaves automation (Value) regions on their owning track for both
selection moves/copies and range operations, even when regions overlap. It does
not create note tracks or redirect automation ownership. Audio and note regions
retain the existing relocation behavior. Push-existing inventories displaced
regions by identity in first-visit order, computes their union bounds in one
pass, and moves each once to a single suitable track below. Dense inventories
are not expanded into function arguments. These edits remain undoable as one
normal editing transaction.

### Audio initialization ownership and limits

`AudioDevices.requestStream` owns acquired tracks until both acquisition and
input enumeration succeed. If enumeration refuses setup, every acquired track
is stopped and the caller receives the generic enumeration warning; success
transfers the live stream to the caller. Permission diagnostics do not include
browser-provided device/constraint details. Input refreshes retain the last
complete list while pending or on failure. Only the latest requested enumeration
may publish; a failed newer refresh also invalidates older completions.

`AudioWorklets.createFor` shares one pending/completed installation and one owner
per BaseAudioContext. Contexts remain independent. Rejected attempts are evicted
so a later call can retry; `get` exposes only successfully installed owners.
Recording rings admit 1–32 integral channels and at least two integral chunks
(one chunk cannot distinguish readable data from an empty ring). Safe arithmetic
and a 64 MiB audio budget are checked before allocating or constructing a node.
The shared layout remains two Int32 pointers (8 bytes), followed by
`channels * chunks * 128` Float32 samples in planar chunk order. The maximum
allocation is therefore 64 MiB + 8 bytes; invalid geometry throws RangeError.

Engine worklet and offline renderer RPC senders belong to their existing
terminators. Shutdown rejects outstanding requests and retires their callbacks;
late worker replies cannot revive them. See the
[runtime sender contract](../../lib/runtime/README.md#rpc-sender-lifetime).

### Live room admission and ownership

Both `YSync` factories retain the supplied conflict policy. Remote edits are
checked after pointer hubs have been resolved. Refused edits restore the graph
under the outbound echo guard and publish a single inverse Yjs transaction using
Yjs's UndoManager, including deleted shared maps. Validation failures also refuse
the batch. If restoring the graph itself fails after the remote batch was
committed, both the graph and the Y.Doc keep the remote edit and the failure is
logged, so the two models never diverge. This is optimistic conflict recovery,
not an authoritative server-side admission service; concurrent participants
still use Yjs convergence.

Joining hydrates one owned graph transaction without publishing bootstrap writes
or replacing shared maps/extensions. Failed joins abort and remove subscriptions;
a fresh join may retry. Population prepares the complete detached map set before
publishing it. Same-UUID root replacements require the same box type and apply
primitive/pointer fields transactionally. Remote field paths require the `fields`
marker and canonical decimal signed i16 keys; aliases, fractions and overflow are
refused before address narrowing.

`YService.getOrCreateRoom` owns the document, provider and sync until admission
finishes, then transfers their shared lifetime to the returned project. Callers
must terminate unused results. Failed approval, timeout, hydration, migration or
project setup closes acquired resources and removes pending sync listeners.
Terminating a room project closes its transport and document as well as its sync.

### Recovery log writer lifetime

`SyncLogWriter.terminate()` retires both transaction and active update listeners
and discards the unfinished transaction. Already queued complete commits may finish.
Hashing and synchronous/asynchronous observer failures set the writer's `error`
option, stop further capture and show one “Recovery Log Stopped” notification.
Queued appends do not continue after an unacknowledged commit. Save the project
and start a new recovery log to recover; the failed hash chain is never resumed.
Observers may return a promise; successful settlement acknowledges that commit.
Transactions that complete while a commit is still being acknowledged are
collected into one update commit, so a slow file write costs one append for the
whole batch instead of one per transaction.
The studio file observer acknowledges only after `close()` succeeds, so its commit
counter never claims a failed write was saved. These guarantees do not change the
existing recovery-log wire format.

### Portable DAWproject identity and import ownership

Exports assign each AudioFile UUID one `samples/<uuid>.wav` path, shared by ZIP
packing and every region reference. Display names remain Audio metadata and are
restored on import; slashes/dots in labels cannot affect archive paths. MIDI/audio
effect chains serialize by current index, then UUID for deterministic ties.
Instrument placement and host routing retain their existing rules.

The picker rejects compressed files above 512 MiB before `arrayBuffer()`. Expanded
archive entry/media/total limits still apply. At most two sample decode/peak/save
pipelines run simultaneously. After failure, no further pipeline starts; already
active siblings finish before cleanup. Sample notifications wait for the full batch.

Owned sample saves return a rollback receipt under the existing storage Web Lock.
Preexisting complete assets are preserved. New assets carry an opaque `import-owner`
generation token; compensation removes only a matching generation. Another save
adopts a reused asset by clearing the token, so an earlier import cannot remove it.
Successful imports may retain the inert token until the next save. A later replacement
receives a fresh token. Cleanup failures are logged without replacing the primary
import error; such storage failures can require manual library recovery. No promise
of process-crash recovery is added. Run the core DAWproject/SamplePublication tests
and the synthetic Chromium selection/import fixtures after building.


### Track compaction

`ProjectApi.compactTracks` preserves top-to-bottom greedy placement: each region
tries earlier main lanes in order. Region adapters resolve occupied PPQN endpoints
against the current tempo map, including seconds-based audio. The operation reads
live pointer membership and keeps newly moved regions in its occupancy index.
It never uses transaction-delayed adapter collections to decide whether a lane fits.

For N regions and L lanes, coordinate sorting costs O(N log N); each placement
probe and accepted insert costs O(log N), with at most O(N L) probes. Sparse prefix
maxima avoid repeatedly sorting or scanning target-lane prefixes. Clips and
automation tracks are preserved; the caller wraps compaction in an editing
transaction so moves and empty-lane deletion form one undo step.

### Clock publication

The timestamp worker brackets each response-counter/timestamp write with an
odd/even Int32 publication sequence in word 3 of the existing 32-byte buffer.
HRClock accepts only a stable even observation and consecutive response counters
in the modular Int32 domain, including signed rollover and zero. Initialization
is independent of counter sign. Overlapping or skipped publications return zero
for that measurement without waiting or retrying on the audio thread.

### Clipboard graph ownership

Device cut captures one copyable selection. Protected effects survive cut and
chain reindexing; instruments are copied but remain installed. Cut is available
only when at least one copyable effect and a host exist.
Output paste validates the complete binary graph before clearing master content.
Deletion notifications precede installation notifications in separate transactions,
but both form one undo step. Installation failure compensates the deletion and
preserves earlier undo/redo history.

Clip subscription catchup delivers an owned array snapshot. The subscription is
installed before catchup, so reentrant sequencing changes are delivered in order.
A throwing initial observer retires its subscription before the error propagates.

### Engine readiness and playback intent

Readiness settles once: the ready RPC resolves it, while processor errors and
pre-ready retirement reject it. Retirement detaches fault listeners and the
client RPC executor. An internal observer prevents unhandled readiness rejection
when no caller awaits it. Play after AudioContext resume is bound to the current
worklet and transport intent. Stop, replacement and release invalidate pending
Play; a current resume refusal displays a playback error and allows retry.

### Recording acquisition and monitor routing

`Capture.prepareRecording()` returns an owned `Terminable` for prepared resources.
Audio preparation owns the worklet before registration/connection; a successful
`startRecording()` transfers that resource to the recording subscription. A
failed start leaves it eligible for retirement. MIDI preparation returns an empty
handle. Preparation retirement preserves intentionally armed input monitoring.

Recording waits for all preparations to settle, including late successes, then
unwinds every returned handle on failure. Each capture subscription is owned
before the next capture or automation/transport step starts. Failure resets
global recording ownership even when cleanup throws, and Project reports one
startup error. Project Stop and retirement abort the pending attempt; shared worklet Stop also
invalidates it when invoked by another transport facade; admission
is checked again before capture/transport publication. A new recording can begin
after canceled preparations finish retiring. Retired audio captures stop owned
streams and discard/stop streams that arrive after retirement.

Monitor sink changes keep candidate elements/destinations local until the latest
selection succeeds. Superseded candidates pause and disconnect without changing
current routing. Only a failed current selection falls back to the default output;
retirement prevents any pending selection from installing.

### Provider inventory admission

Drive and Dropbox inventories admit at most 1,000 pages and 100,000 names. Repeated
or empty continuation cursors and overflow reject the entire inventory; partial
results never authorize backup cleanup. Drive exact-name lookups request two matches
and refuse duplicates or incomplete results before mutation. Backups live in Drive's
hidden `appDataFolder`, and there is no in-app repair yet: a duplicated folder or file
keeps that path's operations refused (nothing is changed) until a deterministic
resolution or repair step exists. This deliberately trades backup availability for
never mutating an arbitrary duplicate. Name query literals escape backslashes before
apostrophes, independently of URL encoding.

Every provider operation accepts optional cancellation and has one elapsed deadline
covering lookup, pagination and body consumption: ten minutes plus one second per
128 KiB of its transfer budget (upload size, or the download path's byte limit),
so slow links can still move large media while a stalled exchange ends. Cancellation
retires pending reads and folder lookup ownership; late headers are cancelled.
Remote writes already accepted by a provider may still complete after cancellation;
no atomic remote rollback is promised. Provider failures expose fixed operation/HTTP
status categories without raw response text, SDK objects, account paths or causes.
Unused error bodies are cancelled; Dropbox's missing-path classifier reads at most
1 MiB of structured error data. No raw provider response is logged.

Cloud downloads enforce existing OPFS limits while streaming: JSON metadata 1 MiB,
aggregate `index.json` catalogs 64 MiB, presets 16 MiB, project graphs 64 MiB,
sample/font/cover media 1 GiB. A transport failure while reading a body stays
retryable like the same failure before headers; byte-limit and encoding refusals
are final. Declared and
actual decoded bytes are checked before assembly. Fetch-decoded gzip, deflate and
Brotli plus identity are supported; other encoding declarations are refused. SDK download responses are bounded before Blob materialization.

Stock preset downloads use the same 16 MiB declared/actual byte ceiling with or
without progress. Identity and fetch-decoded gzip/deflate/Brotli are accepted;
unsupported encoding declarations are refused. Aborting after a prefix
rejects without returning partial bytes. A throwing progress observer or source
read failure rejects the load and cancels/unlocks the reader; EOF reports completion.

Stock sample and preset loads share four permits across metadata, body consumption
and sample decoding, releasing on completion, abort or failure. Queued cancelled
preset loads settle as soon as their signal aborts, without waiting for a permit or
starting requests. Cloud read retries stop
after three transient attempts; permanent HTTP errors, missing files, aborts and
invalid content stop immediately. Mutations retain explicit approval-based retry.

### Monitoring graph ownership

MonitoringRouter owns exact source/splitter/merger connections and its worklet
output edge. Replacement prepares a complete generation before publishing its map;
a failed preparation retains the previous registry and graph. Failed publication
restores the previous map. If restoration also fails, the router stops, detaches
its graph and attempts an empty map, then throws an explicit stopped error.
Termination is idempotent, publishes an empty map and preserves foreign edges.

### Recovery update framing

Sync-log replay decodes each complete update payload before opening its graph
transaction. Unknown tags, incomplete values and trailing bytes are refused
without applying any update from that commit. This uses the
[bounded lib-box update decoder](../../lib/box/README.md#recovery-update-payload-admission);
valid update-log round trips retain their existing wire format.

### DAWproject playback preservation and refusals

DAWproject export preserves note loop offsets and converts seconds-based audio
source trims to beats at constant tempo. Nonzero note event offsets and invalid
source loop windows are refused before media packing; copy notes to a new
region when the source has a nonzero event offset.

DAWproject channels retain mute and solo independently of clip mute. Auxiliary
sends retain destination, pre/post routing, gain, pan and enable state; disabled
sends keep their saved settings while producing silence and can be re-enabled from
the mixer send menu. Existing projects default
sends to enabled.

DAWproject export refuses nonempty parameter automation regions and launcher
clips (note, audio or value), before packing samples or presets. Move launcher
content to the arrangement for interchange. Empty launcher rows and dedicated
tempo/time-signature automation remain supported.

DAWproject export refuses expressive notes with ratchets/play curves, cent detune,
chance or repeat features. Audio region gain must be 0 dB. Linear fades (slope
0.5) are exported in explicit beat units, with finite nonnegative extents no
greater than the region duration. Shaped fades require rendering before export;
inactive fade slopes do not affect admission.

Native openDAW DAWproject devices with self-contained state are restored with new
IDs and a host in the destination graph, preserving parameters, enabled state and
effect order. State is checked in a temporary graph before constructing the
imported project. Missing/malformed state, wrong device identity/role, external
pointers, dependent resources, multiple instruments and unsupported native roles
on bus channels are explicitly refused; these devices require
rendering or removal before interchange. No replacement instrument is substituted.
Audio buses are channels, not native instrument presets. The structural
`AudioBusBox` instrument entries that earlier openDAW exports wrote on bus
channels are skipped, so those files still import. Native device state contains
only the device and the boxes it owns: selections, controller mappings and
automation lanes that refer to the device are not exported with it. Nonempty generic Points
parameter lanes are refused before graph construction; dedicated tempo and
time-signature automation remain supported.

Explicit clip playStop windows are not representable by the current import path
and are refused before graph construction or asset requests. Audio fades accept
finite nonnegative extents up to the clip duration, with explicit fadeTimeUnit=beats
for nonzero fades, and become linear region envelopes. Nonzero fades without a
unit or in seconds, note fades and inner-wrapper fades are refused. Overlapping
linear fades use the quieter envelope, matching local playback.
