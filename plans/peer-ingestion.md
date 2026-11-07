# Bounded peer and archive ingestion

Round 59 B1 with coding assistance: validate frames and matching active UUID, then
count/index/actual wire bytes, then actual ZIP expansion using JSZip internalStream
public API. Bad transfers terminate with bounded errors and cleanup. Peer ZIP limit
512 MiB, at most 8192 chunks of at most 64 KiB. ZIP: 1024 entries, 1 MiB metadata,
512 MiB per media entry, 1 GiB total. Extraction is sequential and pauses immediately
on overflow; returned assets are published only after complete validated extraction.
No live peer/cloud/model traffic. Synthetic compressed archives use tiny limits.
Run root build/lint/tests and focused ingestion regressions.

Malformed frames use the existing three-attempt retry policy, with connection
identity fencing so old frames cannot poison failover. Project XML has its own
32 MiB cap; the 1 MiB cap applies to metadata. Entry count limits post-parse
processing: JSZip has already parsed the central directory. The runtime dependency
supplies the JSZip types exposed by the public streaming helper declaration.
