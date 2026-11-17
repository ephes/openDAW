# TODO

## Bugs

### Importer

* ~~Each region gets its own track~~
* ~~Region colors are all red~~

## Features

* Built

### Exporter

* ~~Export the openDAW device if found~~
    * ~~Write instrument preset~~
* Write generic parameter automation (nonempty value regions are currently refused).
* Export launcher scenes/clips (populated content is currently refused).
* Note loop offsets are exported. Nonzero event-offset is refused pending playback semantics.

### Importer

* ~~Map to new uuids (not when exporting)~~
* Restore self-contained native device presets with destination hosts.
    * Dependent resources and external pointers are refused pending dedicated support.
* Create generic parameter automation (nonempty Points lanes are currently refused).
* Explicit playStop windows and unsupported fade units are refused.
* Linear audio fades in explicit beats are preserved.
* Note playback offsets and loop spans are imported, including pre-loop lead-ins.
* Multi-clip/multi-content nesting is explicitly unsupported (see core README).
* ~~Auto-select the first audio-unit~~