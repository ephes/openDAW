# Arpeggio pitch order and cent

The arpeggio builds its stack from `iterateActiveNotesAt`, whose order depends on
the source: raw keyboard notes in press order, audition notes, then timeline notes
sorted by start position. The modes indexed that stack directly, so "up" and
"down" followed insertion order rather than pitch. The processor now sorts the
stack by pitch, then cent, before a mode selects a step.

Generated notes were started with the default cent of zero, dropping microtonal
detune from the source note. Every mode now forwards the selected note's cent.

`ArpeggioDeviceProcessor.test.ts` covers cent forwarding and all three modes with
two insertion orders.
