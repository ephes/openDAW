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

## Callback transport, limits and configuration

`CALLBACK_URL` accepts HTTP or HTTPS only. HTTPS uses TLS; the URL path and query
are preserved. Diagnostics never include the URL, query, response body or transport
error detail. `CALLBACK_TIMEOUT` is a decimal integer from 1 to 300000 ms (default
5000), limiting the entire exchange even when response bytes keep arriving.
`CALLBACK_OBJECTS` is a JSON object mapping nonempty shared names to `Array`, `Map`,
`Text`, `XmlFragment` or `XmlElement` (default `{}`). Invalid configuration fails
at module startup with only the setting name. Empty timeout/object settings retain
the defaults, including when callbacks are disabled. Standard Node URL conversion
preserves IPv6 hosts and URL credentials.

Only 2xx responses completed within 64 KiB and the deadline count as success.
Other status codes, errors, premature close and oversized/trickling responses
fail once and release the request slot. There are at most four concurrent requests
and one active request per room, with at most 32 pending rooms. Pending snapshots
coalesce to the latest update for that room; a new pending room is dropped when
full. Outbound JSON is capped at 1 MiB. Delivery is best-effort without retries.
These limits are process-local and apply after the existing per-document debounce.
Run `npm test --workspace=yjs-server` for synthetic transport, clock, configuration
and admission regressions; no callback endpoint or live document is needed.
