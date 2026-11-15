# AI Demux

Choose an audio file, a separation model and an execution provider. Separation
produces drums, bass, other and vocals. Audio playback is suspended during this
work. An already suspended studio stays suspended; overlapping separations restore
playback only after the last operation finishes.

The operation belongs to the project where it was started. Switching or closing
that project discards pending results, including results arriving during sample
import. Results are never redirected into the newly opened project.

Each stem must import and load its audio successfully before the four tracks are
added together in one undoable edit. If any stem fails, **Incomplete Stems** lists
each stem's outcome and no tracks are added. Imported samples remain in the sample
library. Resolve the reported storage/loading problem and run separation again;
there are no partially completed tracks to duplicate or reconcile.
