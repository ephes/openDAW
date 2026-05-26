import {int, isDefined, Option} from "@opendaw/lib-std"
import {LongRecordingChunkEntry, LongRecordingManifest} from "./LongRecordingManifest"

export type LongRecordingChunkStatus =
    | {readonly type: "clean", readonly index: int, readonly frames: int, readonly bytes: int}
    | {readonly type: "missing", readonly index: int, readonly expectedFrames: int, readonly expectedBytes: int}
    | {
    readonly type: "truncated",
    readonly index: int,
    readonly expectedBytes: int,
    readonly actualBytes: int
}
    | {readonly type: "corrupt", readonly index: int, readonly reason: string}
    | {readonly type: "extra", readonly index: int, readonly bytes: int}

export type LongRecordingOverallStatus = "clean" | "recoverable" | "corrupt" | "failed"

export interface LongRecordingRecoveryReport {
    readonly manifest: LongRecordingManifest
    readonly chunks: ReadonlyArray<LongRecordingChunkStatus>
    readonly overall: LongRecordingOverallStatus
    readonly recoverableFrames: int
    readonly recoverableBytes: int
}

export interface ChunkProbe {
    readonly index: int
    readonly bytes: int
}

export namespace LongRecordingRecovery {
    export const FILE_PATTERN = /^(\d{6,})\.pcm$/

    export const parseChunkIndex = (fileName: string): Option<int> => {
        const match = FILE_PATTERN.exec(fileName)
        if (!isDefined(match)) {return Option.None}
        const parsed = Number.parseInt(match[1], 10)
        if (!Number.isFinite(parsed) || parsed < 0) {return Option.None}
        return Option.wrap(parsed)
    }

    export const classify = (
        manifest: LongRecordingManifest,
        probes: ReadonlyArray<ChunkProbe>
    ): LongRecordingRecoveryReport => {
        const probeByIndex: Map<int, ChunkProbe> = new Map()
        for (const probe of probes) {probeByIndex.set(probe.index, probe)}
        const declaredIndexes: Set<int> = new Set()
        const statuses: Array<LongRecordingChunkStatus> = []
        let recoverableFrames = 0
        let recoverableBytes = 0
        let firstBreak = false
        for (const entry of manifest.chunks) {
            declaredIndexes.add(entry.index)
            const expectedBytes = expectedBytesFor(entry, manifest)
            const probe = probeByIndex.get(entry.index)
            if (!isDefined(probe)) {
                statuses.push({
                    type: "missing",
                    index: entry.index,
                    expectedFrames: entry.frames,
                    expectedBytes
                })
                firstBreak = true
                continue
            }
            if (probe.bytes < expectedBytes) {
                statuses.push({
                    type: "truncated",
                    index: entry.index,
                    expectedBytes,
                    actualBytes: probe.bytes
                })
                firstBreak = true
                continue
            }
            if (probe.bytes > expectedBytes) {
                statuses.push({
                    type: "corrupt",
                    index: entry.index,
                    reason: `chunk is larger than expected: ${probe.bytes} > ${expectedBytes}`
                })
                firstBreak = true
                continue
            }
            statuses.push({type: "clean", index: entry.index, frames: entry.frames, bytes: probe.bytes})
            if (!firstBreak) {
                recoverableFrames += entry.frames
                recoverableBytes += probe.bytes
            }
        }
        for (const probe of probes) {
            if (declaredIndexes.has(probe.index)) {continue}
            statuses.push({type: "extra", index: probe.index, bytes: probe.bytes})
        }
        const overall = computeOverall(manifest, statuses, recoverableFrames)
        return {manifest, chunks: statuses, overall, recoverableFrames, recoverableBytes}
    }

    const expectedBytesFor = (entry: LongRecordingChunkEntry, manifest: LongRecordingManifest): int =>
        LongRecordingManifest.expectedChunkBytes(entry.frames, manifest.numberOfChannels, manifest.bytesPerSample)

    const computeOverall = (
        manifest: LongRecordingManifest,
        statuses: ReadonlyArray<LongRecordingChunkStatus>,
        recoverableFrames: int
    ): LongRecordingOverallStatus => {
        const declaredCount = manifest.chunks.length
        if (declaredCount === 0) {
            if (manifest.state === "failed") {return "failed"}
            if (manifest.state === "stopped") {return "clean"}
            return "recoverable"
        }
        const cleanCount = statuses.filter(status => status.type === "clean").length
        if (cleanCount === declaredCount && manifest.state === "stopped") {return "clean"}
        if (cleanCount === declaredCount && manifest.state !== "failed") {return "recoverable"}
        if (recoverableFrames > 0) {return "recoverable"}
        if (manifest.state === "failed") {return "failed"}
        return "corrupt"
    }
}
