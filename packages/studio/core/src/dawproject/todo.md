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
* Write automation
* Introduce event-offset and export loop settings

### Importer

* ~~Map to new uuids (not when exporting)~~
* ~~Create the openDAW device if found~~
    * ~~Read preset~~
* Create automation
* Note playback offsets and loop spans are imported, including pre-loop lead-ins.
* Multi-clip/multi-content nesting is explicitly unsupported (see core README).
* ~~Auto-select the first audio-unit~~