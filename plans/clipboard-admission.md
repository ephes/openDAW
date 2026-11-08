# Clipboard admission

Round 83 bundle B01 covers text byte budgets, binary length preflight and notes
payload graph shape. Re-verified against main 932b4ee: all three issues remained.

Implementation: one shared 8 MiB limit; check encoded size and decoded length
before atob, metadata/graph/box-record lengths before allocation, and temporary
graph types/pointer roles before target creation. Keep existing graph rollback.
Notes support NoteEventBox plus owned NoteEventRepeatBox dependencies. No change
to the other handlers' supported device/region graph shapes.

Validation uses synthetic clipboard events, menu reads and graph fixtures,
including the actual notes handler with BoxEditing and cross-project copy/paste.
Run each regression against the original production files as well as the repair.
Run npm run build, npm run lint and npm test before the Opus review and merge.

Process: implementation and local checks by Codex; independent review through the
Claude review harness (Opus 5.5, high effort). Record its outcome in the resume
note if review cannot complete. No release, deployment or Actions gate.
