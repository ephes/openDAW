
### Initial track ordering

Timeline construction collects the initial audio units and their tracks before
one synchronous final ordering and listIndex assignment. Final indices are ready
when TracksManager construction returns. Later live track/unit additions,
removals and index changes keep the existing immediate ordering behavior.

### Automation editing

Failed point deletions and batch moves restore the visible/playback event index
from graph state before the next edit. Automation and note-property node capture
chooses the nearest point; equal distances keep the first candidate in iteration
order. Property capture retains selected-note priority and the rendered one-pixel
offset.

Tempo lanes display raw BPM ramps through a logarithmic axis. Painted curves,
midpoint handles, the midpoint tooltip, capture and slope gestures all use the same stored BPM domain;
panning or clipping the viewport leaves the depicted curve unchanged. Parameter
automation retains its affine display path.

### Script device failures and lifetime

Initial saved-code loads, default compiles and external reloads show failures on
the current device's error icon and consume background promise rejections. An
explicit Compile still rejects to the code editor and can be retried; success
clears the icon and its message. Older requests and disposed editor instances
cannot update that UI. A Compile issued from the code editor after its device
panel was remounted still compiles and reports to the code editor; only the
retired panel's icon stays untouched. Remounting joins the device/context's pending installation
so closing or reopening the presentation cannot replace a pending explicit script
with older saved/default code. External code changes still load immediately.

### Audio region conversion

Converting an audio region to a clip keeps its native loop duration and time base,
source waveform offset, file and playback mode. It does not convert an already
native seconds value a second time. Existing saved conversions are not migrated;
region-only fades and loop offset are outside this operation.

### Piano panel roster

The piano panel follows current note-track and audio-unit membership/order. It
rebuilds and retires track controls when membership or exclusions change, and
closes all current subscriptions when the panel closes. Track labels retain the
unit label and numbered suffix convention.
