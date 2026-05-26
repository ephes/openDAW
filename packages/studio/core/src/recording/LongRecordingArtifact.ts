import {Arrays, Option, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {LongRecordingManifest} from "./LongRecordingManifest"
import {LongRecordingOverview} from "./LongRecordingOverview"
import {LongRecordingRecovery} from "./LongRecordingRecovery"
import {LongRecordingStorage} from "./LongRecordingStorage"

export interface LongRecordingArtifactFile {
    readonly path: string
    readonly bytes: Uint8Array
}

export namespace LongRecordingArtifact {
    export const isLongRecording = async (opfs: OpfsProtocol, recordingId: UUID.String): Promise<boolean> => {
        const manifestPath = `${LongRecordingStorage.dirFor(recordingId)}/${LongRecordingStorage.MANIFEST_NAME}`
        const {status, value} = await Promises.tryCatch(opfs.exists(manifestPath))
        return status === "resolved" && value === true
    }

    export const collect = async (
        opfs: OpfsProtocol,
        recordingId: UUID.String
    ): Promise<ReadonlyArray<LongRecordingArtifactFile>> => {
        const dir = LongRecordingStorage.dirFor(recordingId)
        const files: Array<LongRecordingArtifactFile> = []
        const manifestResult = await Promises.tryCatch(
            opfs.read(`${dir}/${LongRecordingStorage.MANIFEST_NAME}`))
        if (manifestResult.status === "rejected") {return Arrays.empty()}
        files.push({path: LongRecordingStorage.MANIFEST_NAME, bytes: manifestResult.value})
        const chunksDir = `${dir}/${LongRecordingStorage.CHUNKS_DIR}`
        const listResult = await Promises.tryCatch(opfs.list(chunksDir))
        if (listResult.status === "rejected") {return files}
        for (const entry of listResult.value) {
            if (entry.kind !== "file") {continue}
            const readResult = await Promises.tryCatch(opfs.read(`${chunksDir}/${entry.name}`))
            if (readResult.status === "rejected") {continue}
            files.push({path: `${LongRecordingStorage.CHUNKS_DIR}/${entry.name}`, bytes: readResult.value})
        }
        return files
    }

    export const restore = async (
        opfs: OpfsProtocol,
        recordingId: UUID.String,
        files: ReadonlyArray<LongRecordingArtifactFile>
    ): Promise<Option<LongRecordingManifest>> => {
        const dir = LongRecordingStorage.dirFor(recordingId)
        for (const file of files) {
            await opfs.write(`${dir}/${file.path}`, file.bytes)
        }
        const storage = LongRecordingStorage.create(recordingId, opfs)
        return storage.readManifest()
    }

    export const verifyRoundTrip = async (
        opfs: OpfsProtocol,
        recordingId: UUID.String
    ): Promise<Option<RoundTripReport>> => {
        const storage = LongRecordingStorage.create(recordingId, opfs)
        const manifestOption = await storage.readManifest()
        if (manifestOption.isEmpty()) {return Option.None}
        const manifest = manifestOption.unwrap()
        const probes = await storage.listChunkProbes()
        const recovery = LongRecordingRecovery.classify(manifest, probes)
        return Option.wrap({manifest, recovery, probeCount: probes.length})
    }

    export interface RoundTripReport {
        readonly manifest: LongRecordingManifest
        readonly recovery: ReturnType<typeof LongRecordingRecovery.classify>
        readonly probeCount: number
    }

    export const isOverviewArtifactFile = (relativePath: string): boolean =>
        relativePath.startsWith(`${LongRecordingStorage.CHUNKS_DIR}/`)
            && LongRecordingOverview.isOverviewFileName(relativePath)

    export interface ProbeEntry {
        readonly recordingId: UUID.String
        readonly report: RoundTripReport
    }

    /**
     * Enumerate every long-recording artifact under `recordings/v1/*` and return a verify report for each.
     * Recordings without a manifest (already deleted, never written, or directory present but empty) are
     * silently skipped. Caller is responsible for filtering by recovery state.
     */
    export const probeAll = async (opfs: OpfsProtocol): Promise<ReadonlyArray<ProbeEntry>> => {
        const listResult = await Promises.tryCatch(LongRecordingStorage.listAll(opfs))
        if (listResult.status === "rejected") {return Arrays.empty()}
        const entries: Array<ProbeEntry> = []
        for (const recordingId of listResult.value) {
            const reportOption = await verifyRoundTrip(opfs, recordingId)
            if (reportOption.isEmpty()) {continue}
            entries.push({recordingId, report: reportOption.unwrap()})
        }
        return entries
    }
}
