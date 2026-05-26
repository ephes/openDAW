import css from "./RecoverableRecordingsPanel.sass?inline"
import {createElement, replaceChildren} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {Lifecycle, RuntimeNotifier, Terminable, UUID} from "@opendaw/lib-std"
import {
    LongRecordingArtifact,
    LongRecordingChunkStatus,
    LongRecordingRecoveryReport,
    LongRecordingStorage,
    Workers
} from "@opendaw/studio-core"
import {Promises} from "@opendaw/lib-runtime"

const className = Html.adoptStyleSheet(css, "RecoverableRecordingsPanel")

type Construct = {
    lifecycle: Lifecycle
}

interface ProbeRow {
    readonly recordingId: UUID.String
    readonly report: LongRecordingArtifact.RoundTripReport
}

const summarizeChunks = (chunks: ReadonlyArray<LongRecordingChunkStatus>): string => {
    const counts: Record<string, number> = {clean: 0, missing: 0, truncated: 0, corrupt: 0, extra: 0}
    for (const chunk of chunks) {counts[chunk.type] = (counts[chunk.type] ?? 0) + 1}
    return `${counts.clean ?? 0} clean · ${counts.missing ?? 0} missing · `
        + `${counts.truncated ?? 0} truncated · ${counts.corrupt ?? 0} corrupt · `
        + `${counts.extra ?? 0} extra`
}

const formatSeconds = (totalSeconds: number): string => {
    const total = Math.max(0, Math.floor(totalSeconds))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    const pad = (value: number): string => value.toString().padStart(2, "0")
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) {return `${bytes} B`}
    if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`}
    if (bytes < 1024 * 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(1)} MB`}
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const overallToTone = (overall: LongRecordingRecoveryReport["overall"]): string => {
    switch (overall) {
        case "clean": return "ok"
        case "recoverable": return "warn"
        case "corrupt": return "warn"
        case "failed": return "error"
        default: return "warn"
    }
}

const buildInspectDialog = (row: ProbeRow): HTMLDialogElement => {
    const dialog: HTMLDialogElement = (
        <dialog className="recoverable-inspect">
            <h4>Recording {row.recordingId.slice(0, 8)}</h4>
            <p>Overall: <strong>{row.report.recovery.overall}</strong></p>
            <p>Sample rate: {row.report.manifest.sampleRate} Hz · channels: {row.report.manifest.numberOfChannels}</p>
            <p>Total frames: {row.report.manifest.totalFrames} ({formatSeconds(row.report.manifest.totalFrames / Math.max(1, row.report.manifest.sampleRate))})</p>
            <p>Recoverable frames: {row.report.recovery.recoverableFrames}</p>
            <table>
                <thead>
                    <tr><th>Chunk</th><th>Status</th><th>Detail</th></tr>
                </thead>
                <tbody>
                    {row.report.recovery.chunks.map(chunk => (
                        <tr>
                            <td>{chunk.index}</td>
                            <td>{chunk.type}</td>
                            <td>{chunkDetail(chunk)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <button onclick={() => dialog.close()}>Close</button>
        </dialog>
    )
    return dialog
}

const chunkDetail = (chunk: LongRecordingChunkStatus): string => {
    switch (chunk.type) {
        case "clean": return `${chunk.frames} frames`
        case "missing": return `expected ${chunk.expectedBytes} B`
        case "truncated": return `${chunk.actualBytes} / ${chunk.expectedBytes} B`
        case "corrupt": return chunk.reason
        case "extra": return `unexpected file (${chunk.bytes} B)`
        default: return ""
    }
}

const buildRow = (row: ProbeRow, refresh: () => Promise<void>): HTMLElement => {
    const {recordingId, report} = row
    const {manifest, recovery} = report
    const duration = formatSeconds(manifest.totalFrames / Math.max(1, manifest.sampleRate))
    const sizeBytes = manifest.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)
    const onInspect = () => {
        const dialog = buildInspectDialog(row)
        document.body.appendChild(dialog)
        dialog.addEventListener("close", () => dialog.remove())
        dialog.showModal()
    }
    const onDiscard = async () => {
        const approved = await RuntimeNotifier.approve({
            headline: "Discard Recording",
            message: `Permanently delete recording ${recordingId.slice(0, 8)}? `
                + `This cannot be undone.`,
            approveText: "Discard",
            cancelText: "Cancel"
        })
        if (!approved) {return}
        const storage = LongRecordingStorage.create(recordingId, Workers.Opfs)
        const {status, error} = await Promises.tryCatch(storage.delete())
        if (status === "rejected") {
            await RuntimeNotifier.info({headline: "Discard Failed", message: String(error)})
            return
        }
        await refresh()
    }
    return (
        <div className={`row ${overallToTone(recovery.overall)}`}>
            <header>
                <span className="id">{recordingId}</span>
                <span className={`badge ${overallToTone(recovery.overall)}`}>{recovery.overall}</span>
            </header>
            <div className="meta">
                <span>{manifest.sampleRate} Hz · {manifest.numberOfChannels} ch · {duration}</span>
                <span>{summarizeChunks(recovery.chunks)}</span>
                <span>{formatBytes(sizeBytes)}</span>
            </div>
            <div className="actions">
                <button className="secondary" onclick={onInspect}>Inspect</button>
                <button className="destructive" onclick={onDiscard}>Discard</button>
            </div>
        </div>
    )
}

export const RecoverableRecordingsPanel = ({lifecycle}: Construct) => {
    const container: HTMLElement = <div className="recordings-list"/>
    const heading: HTMLElement = <h3>Recoverable Recordings</h3>
    const empty: HTMLElement = <p className="empty">No interrupted recordings.</p>
    let disposed = false
    const refresh = async (): Promise<void> => {
        if (disposed) {return}
        const {status, value, error} = await Promises.tryCatch(
            LongRecordingArtifact.probeAll(Workers.Opfs))
        if (disposed) {return}
        if (status === "rejected") {
            replaceChildren(container,
                <p className="error">Could not enumerate recordings: {String(error)}</p>)
            return
        }
        const rows = value.filter(entry => entry.report.recovery.overall !== "clean")
        if (rows.length === 0) {
            replaceChildren(container, empty)
            return
        }
        replaceChildren(container, ...rows.map(row => buildRow(row, refresh)))
    }
    lifecycle.own(Terminable.create(() => {disposed = true}))
    refresh().catch(error => console.warn("[RecoverableRecordingsPanel] refresh failed", error))
    return (
        <div className={className}>
            {heading}
            {container}
        </div>
    )
}
