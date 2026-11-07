# Parameter roundtrips

Verified all four round-69 O2 findings on main; synthetic regressions reproduce
them before repair. Keep parsing explicit and reuse the existing mappings and
parameter API. Tests exercise parameter editing and real inverse subscriptions.
Source inspection and local build/lint/tests support the change; separate review
is required before merge.
