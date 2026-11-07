# Restore the baseline lint gate

The starting main branch builds but its workspace lint gate fails on authored
source, compiler-project exclusions and generated declarations. This maintenance
slice preserves runtime algorithms and package exports while making that gate
usable for queued work.

- Exclude dist output from shared linting. Authored declarations and tests remain
  checked; no rule is disabled for all declaration files.
- Remove parserOptions.project from package configs: the recommended rules used
  here are syntax rules and need no compiler services. Tests and tool configs are
  intentionally outside production tsconfig files but must still be linted.
- Allow TypeScript namespaces. They are an established public API convention,
  including merged class/type namespaces, rather than accidental internal modules.
  Converting them would change exports and initialization semantics for no lint benefit.
- Replace untyped storage, callbacks, global extensions and worker messages with
  concrete types, generic parameters or unknown. Keep narrow, commented exceptions
  where heterogeneous generic registries or conditional visitors must erase a
  value type without changing their existing public call contract. Keep the
  externally mutated pointer-lock preference mutable.
- Add a push/pull-request Checks workflow for the documented install/build/lint/test
  commands; keep deployment workflows manual.
- Use scoped switch blocks, const for local single assignments, for loops for
  indefinite iteration, and equivalent regex/string expressions. Correct typeof
  comparisons to the string "undefined" so feature detection handles absent values.

Configuration regression tests cover authored test/config files, generated-output
exclusion, namespace merging and continued rejection of explicit any. They fail
with the original configuration. A browser feature-detection regression covers
properties whose value is undefined. Typed setter coverage preserves the console
accessor call contract. JSX style values retain the existing CSS property types;
color objects are stringified at their anchor call sites. Existing tests check the runtime algorithms.

Implementation used Codex for edits and local validation, followed by the separate
Claude review harness. Changes are split by package group for reviewability; no
version or release is created.
