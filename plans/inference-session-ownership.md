# Inference session ownership

Round 63 B3 with coding assistance: host single-flight loads plus per-task worker
ordering, awaited release, then cancellation publication checks. Use fake host and
ONNX worker modules; no real models or downloads. Validate focused inference tests
and root build/lint/tests. Cancellation retires the caller, not shared ONNX compute.
