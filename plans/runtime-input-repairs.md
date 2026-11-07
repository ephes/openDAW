# Runtime input repairs

Round 63 B8: patch markdown-it within 14.x and preserve exact soundfont read views. Synthetic adversarial references, help/table fixtures and a synthetic valid SF2 over a sentinel-backed view cover production callers. Validate with root build/lint/tests and targeted npm audit; retain unrelated audit findings.

Review: small adversarial inputs are rendering smoke checks; patched floor/lock assertions are the security regression gate. Avoid wall-clock/performance-ratio tests because checks must be platform-independent. Fixed Node file URL construction after the initial fixture error and verified old floor/lock now fail the intended assertions.
