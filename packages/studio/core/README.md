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
