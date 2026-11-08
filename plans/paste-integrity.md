# Paste failure and placement integrity

Round 83 bundle B02 was rechecked against main at b7bab7a8; all three findings
still applied. B01 admission protections were already merged and retained.

Notes, values and regions publish their new selection as the last step inside
the paste transaction, after all fallible decoding and creation work, so a paste
and its selection undo as one history step; the cursor advances only after
BoxEditing commits successfully. Graph decoding/creation remains transactional;
a corrupt payload or an installation failure leaves external editor state alone.
Value paste decodes and creates incoming boxes before deleting overlapping values.

Time metadata must contain finite ordered endpoints (equal endpoints support one
value event). Region records require valid TrackType values, unique UUIDs and
nonnegative unique offsets; destination lookup bounds those offsets before editing.
Malformed or truncated records are rejected before graph changes. Relative track
spacing is retained. Clipboard read errors can use fallback; handler failures
propagate to the existing unhandled-rejection path once.

Implementation used Codex with synthetic Vitest fixtures and real BoxEditing
rollback. Tests assert graph bytes, adapter identity and cursor preservation after
corruption and injected post-creation failure, reject malformed metadata before
editing, and exercise the installed menu callback for replay and permission denial.
Regression verification runs the new tests against the previous production files.
Required review: claude-review-loop, claude-opus-5-5, high effort. Full local gates:
npm run build, npm run lint, npm test. No deployments, releases or Actions used.
