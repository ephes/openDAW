This package is part of the openDAW SDK

Preset import requires an eight-byte header before either magic/version integer is
read. Short presets use the existing notification or Attempt failure channel and
do not touch the target graph.
