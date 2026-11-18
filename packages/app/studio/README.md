
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

### Audio editor loop and slip gestures

Loop-length resizing and waveform slipping in the audio editor write the clip or
region live while dragging. Releasing the pointer commits the gesture as one undo
step. Escape, pointer cancellation, lost capture and closing the editor restore the
original value: without other edits in between, the gesture leaves no history entry;
otherwise (or after a save marked it) one compensating step restores only the
gesture's own field and keeps the other edits. A field that another editor changed
or deleted during the drag is no longer written or restored by the gesture.

Audio clip loop lengths are written through the clip's time base (PPQN or
seconds). A resize never drops below a sixteenth note, or below the length the
clip had when the gesture started if that was already shorter; the audio clip
reader ignores nonpositive lengths. Audio regions keep the existing sixteenth-note
floor of the region reader.

### Content editor subscriptions

The region bound strip above a content editor watches the edited region's track
pointer once and keeps exactly one listener on the region's current track; moving
the region retires the previous track listener and repaints once, and a detached
region binds none. `EventOwnerReader.keeoOverlapping` returns one terminable that
owns both the box subscription and the frame-deferred range follow-up: terminating
it (closing or switching the editor) also drops an already queued follow-up, so a
previous region cannot move the next editor's viewport. Active readers still
coalesce several changes in one frame into one range move.

### Piano panel roster

The piano panel follows current note-track and audio-unit membership/order. It
rebuilds and retires track controls when membership or exclusions change, and
closes all current subscriptions when the panel closes. Track labels retain the
unit label and numbered suffix convention.

### Panel binding ownership

Panel factories create content under a candidate lifecycle. The previous
content is retired first, so state it flushes on termination is visible to the
new content. Failed creation retires candidate resources and allows retry.
Failed popout creation closes the candidate window and, once that window has
unloaded, rebuilds the embedded content (or minimizes the panel if that also
fails); a failed return to embedded content leaves the panel minimized so it can
be reopened. Binding handles act only on
their own placeholder and can be terminated repeatedly.

### Control clipboard payloads

Number, timecode and text controls accept application/json only for plain objects
with the matching openDAW app/content markers. Numbers must be finite; text must
be a string no longer than the control's maxChars (127 by default). Invalid or
malformed payloads do not write the model or consume native paste, preserving
ordinary clipboard fallback. Numeric guards still run on accepted values.
Text controls follow external model changes and accepted application pastes;
unchanged editable text retains its text node and selection. Closing the control
retires the model subscription.

### Recovery, piano timing and owned note edits

First-party stack/source evidence keeps an error fatal despite injected scripts;
unknown rejection values yield bounded diagnostics even when their getters or
proxies throw. Source-less failures alone do not establish extension provenance;
stacks whose frames carry no source URL (Safari isolated-world `fn@` frames)
stay nonfatal unless first-party evidence is present; header-only stacks stay fatal.
Piano keys include exact note onsets and exclude completions in the current loop
cycle. Invalid stored keyboard layouts use the existing default without changing
the saved index, including live layout changes and undo.

Duration and velocity/chance/cent drags preview and commit the original surviving
note set and captured base values. New selections cannot redirect an active edit;
detached, reparented or conflicting targets are excluded. Escape discards preview
and approval remains one undo transaction. See [round 142](../../../plans/scout-round142-studio-boundaries.md).

While dragging an audio region fade, the other fade is shortened only as much
as the current overlap requires. Moving the handle back restores the other fade;
cancelling restores both original lengths without adding an undo step when the
gesture owns the pending edit.
