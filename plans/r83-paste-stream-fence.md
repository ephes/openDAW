# Round 83 B03: pending paste and queued MIDI stream fences

Both slices were reverified against main at d08d9519 and still applied.

`opendaw-pending-paste-owner-lifetime`: `ClipboardManager.install` awaited
`Clipboard.readText()` for the menu paste and for the context-menu entry, then
called `canPaste`/`paste` on the handler even if the installation had been
terminated meanwhile (editor closed). Stale menu Copy/Cut/Paste procedures also
still reached the handler. The installation now carries a lifetime flag cleared
on termination; every procedure and every post-await continuation checks it.

`opendaw-midi-queued-stream-disarm-fence`: `CaptureMidi` sequentializes stream
updates, so an update queued by arming or a channel/device change ran after a
synchronous disarm or `terminate()` and installed a fresh `midimessage` stream
that nothing would remove: MIDI kept reaching the engine while disarmed and the
listener leaked after disposal. `#updateStream` now returns when the capture is
disarmed or terminated.

Tests (synthetic, jsdom): `ClipboardAdmission.test.ts` (deferred clipboard reads
settling after uninstall, stale menu procedures, installed control) and
`CaptureMidi.test.ts` (counted synthetic input listeners; arm/disarm, channel
change/disarm and arm/terminate races, armed control). The regression tests fail
against the previous production files and pass with the fix.
