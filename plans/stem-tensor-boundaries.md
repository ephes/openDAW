# Stem tensor boundaries

Round 63 B5, input/planner validation before tensor outputs. Coding-assisted repair
uses synthetic sessions and typed arrays; no ONNX/model execution. Validate focused
inference tests and root build/lint/tests. Preserve the four-stem ordering.

Review disposition: include bounded received/expected tensor details. Validation uses
synthetic sessions only as requested; the real smank/jx model binaries were not
downloaded or executed. Their documented layouts remain the accepted contract;
alternate export layouts/extra outputs now reject explicitly.
