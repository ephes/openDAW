This package is part of the openDAW SDK

Preset import requires an eight-byte header before either magic/version integer is
read. Short presets use the existing notification or Attempt failure channel and
do not touch the target graph.

Werkstatt integer declarations are validated through ValueMapping during parsing,
so ranges collapsed by rounding/clamping produce `Malformed @param` before any
parameter mappings change. Run `npm test --workspace=@opendaw/studio-adapters`
after building; this runs the existing ScriptDeclaration suite.
