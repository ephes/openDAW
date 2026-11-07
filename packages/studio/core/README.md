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
