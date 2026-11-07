# Collaboration transport

`npm test --workspace yjs-server` runs Node Vitest regressions with synthetic documents,
fake clocks, synthetic peers and ephemeral loopback HTTP/WebSocket sockets. Tests require
no certificates, accounts, cloud services or production server access.

The production HTTPS entry point is `server.js`; `transport.js` attaches the same handlers
to an existing HTTP(S) server. Both Yjs and `/signaling` upgrades use the shared browser
Origin policy before WebSocket allocation. Allowed browser origins are:

- `https://opendaw.studio`
- `https://dev.opendaw.studio`
- `https://live.opendaw.studio`
- `https://localhost:8080`
- `https://inspector.yjs.dev`

An absent Origin is allowed for native/non-browser clients. A present foreign or `null`
Origin receives HTTP 403. Origin checking is not authentication or room authorization;
non-browser clients can choose their own Origin header. HTTP CORS uses the same list.

Signaling messages have a 16 KiB inbound payload ceiling. Topics must be nonempty strings
of at most 256 UTF-8 bytes. A subscribe/unsubscribe batch contains at most 32 topics, and
a connection may subscribe to at most 32 distinct topics. Invalid batches are rejected
before adding any topics and close the peer with code 1008. Empty signaling rooms are
removed immediately, without retaining timers, so subscribe/unsubscribe churn cannot
accumulate abandoned room state. Yjs retains ws's separate default inbound limit (100 MiB).

Both signaling and Yjs stop sending if a socket is not OPEN, or if its buffered bytes plus
the next message exceed 8 MiB. The peer is removed through the existing room/awareness
cleanup and terminated to release queued data; other peers continue receiving in order.
An individual message larger than this ceiling also disconnects that recipient.

Optional callbacks debounce independently per document using `CALLBACK_DEBOUNCE_WAIT`
(default 2000 ms) and `CALLBACK_DEBOUNCE_MAXWAIT` (default 10000 ms), retaining lib0's
existing timing semantics. Destroying a document cancels its pending debounce callback.
