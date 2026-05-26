import {Arrays, UUID} from "@opendaw/lib-std"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {LongRecordingArtifact, LongRecordingArtifactFile} from "./LongRecordingArtifact"

export interface BundleFolderWriter {
    file(path: string, data: Uint8Array, options?: {binary: boolean}): void
}

export interface BundleFolderReader {
    forEach(callback: (path: string, file: BundleFolderEntry) => void): void
}

export interface BundleFolderEntry {
    readonly dir: boolean
    async(type: "arraybuffer"): Promise<ArrayBuffer>
}

export interface AudioFileBoxRef {
    readonly uuid: UUID.Bytes
}

export interface AudioFileBoxClassification {
    readonly sampleBoxes: ReadonlyArray<AudioFileBoxRef>
    readonly longRecordings: ReadonlyArray<AudioFileBoxRef>
}

export namespace LongRecordingBundleAdapter {
    export const classifyAudioFileBoxes = async (
        opfs: OpfsProtocol,
        audioFileBoxes: ReadonlyArray<AudioFileBoxRef>
    ): Promise<AudioFileBoxClassification> => {
        const sampleBoxes: Array<AudioFileBoxRef> = []
        const longRecordings: Array<AudioFileBoxRef> = []
        for (const ref of audioFileBoxes) {
            const recordingId = UUID.asString(UUID.toString(ref.uuid))
            const isLongRecording = await LongRecordingArtifact.isLongRecording(opfs, recordingId)
            if (isLongRecording) {
                longRecordings.push(ref)
            } else {
                sampleBoxes.push(ref)
            }
        }
        return {sampleBoxes, longRecordings}
    }

    export const writeIntoFolder = async (
        opfs: OpfsProtocol,
        ref: AudioFileBoxRef,
        target: BundleFolderWriter
    ): Promise<ReadonlyArray<LongRecordingArtifactFile>> => {
        const recordingId = UUID.asString(UUID.toString(ref.uuid))
        const files = await LongRecordingArtifact.collect(opfs, recordingId)
        for (const file of files) {
            target.file(file.path, file.bytes, {binary: true})
        }
        return files
    }

    export const restoreFromFolder = async (
        opfs: OpfsProtocol,
        recordingsFolder: BundleFolderReader
    ): Promise<ReadonlyArray<UUID.String>> => {
        const collected: Map<UUID.String, Array<LongRecordingArtifactFile>> = new Map()
        const writes: Array<Promise<void>> = []
        recordingsFolder.forEach((path, file) => {
            if (file.dir) {return}
            writes.push(file.async("arraybuffer").then(arrayBuffer => {
                const slashIndex = path.indexOf("/")
                if (slashIndex < 0) {return}
                const recordingIdRaw = path.slice(0, slashIndex)
                const relative = path.slice(slashIndex + 1)
                if (!UUID.validateString(recordingIdRaw)) {return}
                const recordingId = UUID.asString(recordingIdRaw)
                const list = collected.get(recordingId) ?? []
                list.push({path: relative, bytes: new Uint8Array(arrayBuffer)})
                collected.set(recordingId, list)
            }))
        })
        await Promise.all(writes)
        if (collected.size === 0) {return Arrays.empty()}
        const restoredIds: Array<UUID.String> = []
        for (const [recordingId, files] of collected) {
            const restored = await LongRecordingArtifact.restore(opfs, recordingId, files)
            if (restored.nonEmpty()) {restoredIds.push(recordingId)}
        }
        return restoredIds
    }

}
