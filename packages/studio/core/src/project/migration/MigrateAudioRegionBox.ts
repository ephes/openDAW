import {BoxGraph} from "@opendaw/lib-box"
import {asInstanceOf, Float, UUID} from "@opendaw/lib-std"
import {AudioFileBox, AudioPitchStretchBox, AudioRegionBox, BoxIO, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {AudioPlayback} from "@opendaw/studio-enums"
import {PPQN, TimeBase} from "@opendaw/lib-dsp"
import {AudioContentHelpers} from "../audio/AudioContentHelpers"

const isIntEncodedAsFloat = (v: number) =>
    v > 0 && v < 1e-6 && Number.isFinite(v) && (v / 1.401298464324817e-45) % 1 === 0

export const migrateAudioRegionBox = (boxGraph: BoxGraph<BoxIO.TypeMap>, box: AudioRegionBox, bpm: number): void => {
    if (box.file.targetVertex.isEmpty()) {
        console.debug("Migrate 'AudioRegionBox' remove region without AudioFileBox")
        boxGraph.beginTransaction()
        box.delete()
        boxGraph.endTransaction()
        return
    }
    const {duration, loopOffset, loopDuration, playback} = box
    const fields = [duration, loopOffset, loopDuration]
    const values = fields.map(field => field.getValue())
    const musical = box.timeBase.getValue() === TimeBase.Musical
    // Modern second-based offsets can contain small normal float32 residues.
    // Only denormals positively signal legacy bits outside the musical domain.
    if (!musical && (values.some(value => value > 0 && value < 2 ** -126)
        || playback.getValue() === AudioPlayback.AudioFit)) {
        throw new Error("Ambiguous legacy audio region timing")
    }
    const encoded = values.map(value => musical && isIntEncodedAsFloat(value))
    const decoded = values.map((value, index) => encoded[index] ? Float.floatToIntBits(value) : value)
    const [oldDuration, oldOffset, oldLoop] = decoded
    if (playback.getValue() === AudioPlayback.AudioFit) {
        const file = asInstanceOf(box.file.targetVertex.unwrap(), AudioFileBox)
        const start = file.startInSeconds.getValue()
        const end = file.endInSeconds.getValue()
        const fileDuration = end - start
        const currentLoopDurationSeconds = PPQN.pulsesToSeconds(oldLoop, bpm)
        const scale = fileDuration / currentLoopDurationSeconds
        const newDuration = PPQN.pulsesToSeconds(oldDuration, bpm) * scale
        const newOffset = PPQN.pulsesToSeconds(oldOffset, bpm) * scale
        if (![start, end, bpm, oldDuration, oldOffset, oldLoop, currentLoopDurationSeconds,
            scale, newDuration, newOffset].every(Number.isFinite)
            || bpm <= 0 || start < 0 || fileDuration <= 0 || oldDuration <= 0 || oldLoop <= 0
            || currentLoopDurationSeconds <= 0 || scale <= 0
            || !Number.isFinite(Math.fround(newDuration)) || Math.fround(newDuration) <= 0
            || !Number.isFinite(Math.fround(newOffset))) {
            throw new Error("Invalid legacy AudioFit timing")
        }
        // Preflight every operand/result before changing any legacy field.
        boxGraph.beginTransaction()
        box.timeBase.setValue(TimeBase.Seconds)
        duration.setValue(newDuration)
        loopDuration.setValue(fileDuration)
        loopOffset.setValue(newOffset)
        playback.setValue("")
        boxGraph.endTransaction()
    } else if (encoded.some(Boolean)) {
        boxGraph.beginTransaction()
        fields.forEach((field, index) => { if (encoded[index]) field.setValue(decoded[index]) })
        boxGraph.endTransaction()
    }
    if (playback.getValue() === AudioPlayback.Pitch) {
        console.debug("Migrate 'AudioRegionBox' to new PitchStretchBox")
        boxGraph.beginTransaction()
        const file = asInstanceOf(box.file.targetVertex.unwrap(), AudioFileBox)
        const fileDuration = file.endInSeconds.getValue() - file.startInSeconds.getValue()
        const pitchBox = AudioPitchStretchBox.create(boxGraph, UUID.generate())
        AudioContentHelpers.addDefaultWarpMarkers(boxGraph, pitchBox, box.loopDuration.getValue(), fileDuration)
        box.timeBase.setValue(TimeBase.Musical)
        box.playMode.refer(pitchBox)
        box.playback.setValue("")
        boxGraph.endTransaction()
    }
    if (box.events.isEmpty()) {
        console.debug("Migrate 'AudioRegionBox' to have a ValueEventCollectionBox")
        boxGraph.beginTransaction()
        box.events.refer(ValueEventCollectionBox.create(boxGraph, UUID.generate()).owners)
        boxGraph.endTransaction()
    }
}
