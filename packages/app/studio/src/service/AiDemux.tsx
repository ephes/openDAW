import {createElement} from "@opendaw/lib-jsx"
import {
    Bytes,
    DefaultObservableValue,
    Errors,
    isAbsent,
    isDefined,
    Option,
    RuntimeNotifier,
    UUID
} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {Files} from "@opendaw/lib-dom"
import {WavFile} from "@opendaw/lib-dsp"
// Keep `@opendaw/lib-inference` as a type-only import; the runtime module is
// loaded by `ensureInference` (see InferenceLoader) so it stays out of the
// studio's boot bundle.
import type {ExecutionProvider, Inference as InferenceNamespace, TaskKey} from "@opendaw/lib-inference"
import {AudioContentFactory, Project, ProjectMeta, ProjectProfile} from "@opendaw/studio-core"
import {InstrumentFactories, Sample} from "@opendaw/studio-adapters"
import {AudioFileBox} from "@opendaw/studio-boxes"
import {Dialogs} from "@/ui/components/dialogs.tsx"
import {StudioService} from "@/service/StudioService"
import {ensureInference} from "@/service/InferenceLoader"

// AiDemux only ever picks a 4-stem separation model. Restrict the key type
// here so `Inference.run(model.key, ...)` infers `StemSeparationInput`/
// `StemSeparationOutput` instead of widening to the union of every
// registered task (which would include `audio-to-midi`).
type StemSeparationKey = Extract<TaskKey, `stem-separation${string}`>

interface ModelOption {
    readonly key: StemSeparationKey
    readonly label: string
    readonly description: string
}

const MODELS: ReadonlyArray<ModelOption> = [
    {
        key: "stem-separation",
        label: "htdemucs v4 (smank, MIT)",
        description: "Hybrid Transformer Demucs v4 — drums / bass / other / vocals.\nONNX export: smank/htdemucs-onnx. License: MIT."
    },
    {
        key: "stem-separation-alt",
        label: "htdemucs v4 (jackjiangxinfa, Apache-2.0)",
        description: "Same Demucs v4 architecture, alternate ONNX export.\nUseful for A/B comparing separation quality. License: Apache-2.0."
    }
]

const STEM_NAMES = ["drums", "bass", "other", "vocals"] as const
type StemName = typeof STEM_NAMES[number]

interface Selection {
    readonly model: ModelOption
    readonly provider: ExecutionProvider
}

const isWebGPUAvailable = (): boolean =>
    isDefined((navigator as Navigator & {gpu?: unknown}).gpu)

const providerLabel = (provider: ExecutionProvider): string =>
    provider === "webgpu" ? "WebGPU (GPU)" : "WASM (CPU)"

// Tracks the EP that was last used to load each task's session. When the
// user picks a different EP we release the in-memory session before
// preload, forcing a re-create with the new EP. Without this, EngineHost
// would reuse the cached session regardless of the requested EP, defeating
// the "test both paths" toggle in the dialog.
const lastProviderByTask = new Map<StemSeparationKey, ExecutionProvider>()

const decodeAudioFile = async (file: File, sampleRate: number):
    Promise<{ audio: Float32Array, channels: 1 | 2, frames: number }> => {
    const arrayBuffer = await file.arrayBuffer()
    const ctx = new AudioContext({sampleRate})
    try {
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        const channels: 1 | 2 = decoded.numberOfChannels >= 2 ? 2 : 1
        const frames = decoded.length
        const planar = new Float32Array(channels * frames)
        for (let c = 0; c < channels; c++) {
            const sourceChannel = decoded.numberOfChannels >= 2 ? decoded.getChannelData(c) : decoded.getChannelData(0)
            planar.set(sourceChannel, c * frames)
        }
        return {audio: planar, channels, frames}
    } finally {
        // Cleanup must not replace the original decode/conversion error.
        try {await ctx.close()} catch (error) {console.warn("Could not close demux decoder", error)}
    }
}

const pickSelection = async (Inference: typeof InferenceNamespace,
                              defaultKey: StemSeparationKey): Promise<Option<Selection>> => {
    const webgpu = isWebGPUAvailable()
    const defaultProvider: ExecutionProvider = webgpu ? "webgpu" : "wasm"
    const renderDescription = (model: ModelOption): string => {
        const size = Bytes.toString(Inference.modelDescriptor(model.key).bytes)
        return `${model.description}\n${size} one-time download.`
    }
    const modelSelect: HTMLSelectElement = (
        <select style={{font: "inherit", padding: "4px 8px", width: "100%"}}>
            {MODELS.map(model =>
                <option value={model.key} selected={model.key === defaultKey}>{model.label}</option>)}
        </select>
    ) as HTMLSelectElement
    const providerSelect: HTMLSelectElement = (
        <select style={{font: "inherit", padding: "4px 8px", width: "100%"}}>
            <option value="webgpu" disabled={!webgpu} selected={defaultProvider === "webgpu"}>
                {`WebGPU (GPU)${webgpu ? "" : " — not available in this browser"}`}
            </option>
            <option value="wasm" selected={defaultProvider === "wasm"}>WASM (CPU)</option>
        </select>
    ) as HTMLSelectElement
    const initial = MODELS.find(model => model.key === defaultKey)
    const descriptionEl: HTMLParagraphElement = (
        <p style={{margin: "8px 0 0", opacity: "0.7", fontSize: "12px", whiteSpace: "pre-line"}}>
            {isDefined(initial) ? renderDescription(initial) : ""}
        </p>
    ) as HTMLParagraphElement
    modelSelect.addEventListener("change", () => {
        const found = MODELS.find(model => model.key === modelSelect.value)
        descriptionEl.textContent = isDefined(found) ? renderDescription(found) : ""
    })
    // Dialogs.show only resolves via its built-in primary button; rely on
    // okText to render "Separate" and read the select values once the
    // promise resolves. (Custom buttons close the dialog but don't trigger
    // the resolve closure.)
    const result = await Promises.tryCatch(Dialogs.show({
        headline: "AI Demux",
        content: (
            <div style={{display: "flex", flexDirection: "column", gap: "8px", minWidth: "360px"}}>
                <label>Model</label>
                {modelSelect}
                <label style={{marginTop: "4px"}}>Execution provider</label>
                {providerSelect}
                {descriptionEl}
            </div>
        ),
        okText: "Separate",
        cancelable: true
    }))
    if (result.status === "rejected") {return Option.None}
    const found = MODELS.find(model => model.key === modelSelect.value)
    if (!isDefined(found)) {return Option.None}
    const provider: ExecutionProvider = providerSelect.value === "webgpu" ? "webgpu" : "wasm"
    return Option.wrap({model: found, provider})
}

// Shared-context suspension is a lease. A new owner waits for an in-flight
// restoration before acquiring the next transition; only the last owner restores.
const suspensions = new WeakMap<AudioContext, {
    owners: number, ready: Promise<void>, restore: boolean, restoring?: Promise<void>
}>()
const withSuspendedAudio = async (context: AudioContext, run: () => Promise<void>): Promise<void> => {
    let lease = suspensions.get(context)
    while (isDefined(lease?.restoring)) {
        await lease.restoring
        lease = suspensions.get(context)
    }
    if (!isDefined(lease)) {
        const restore = context.state === "running"
        lease = {owners: 0, restore, ready: restore ? context.suspend() : Promise.resolve()}
        suspensions.set(context, lease)
    }
    lease.owners++
    try {
        await lease.ready
        await run()
    } finally {
        if (--lease.owners === 0) {
            const owned = lease
            owned.restoring = (async () => {
                try {
                    await owned.ready
                    if (owned.restore && context.state === "suspended") {await context.resume()}
                } finally {suspensions.delete(context)}
            })()
            await owned.restoring
        }
    }
}

export namespace AiDemux {
    export const run = async (service: StudioService): Promise<void> => {
        let profile = service.projectProfileService.getValue().unwrapOrNull()
        const sampleService = service.sampleService
        const sampleManager = service.sampleManager
        const current = () => service.projectProfileService.getValue().unwrapOrNull() === profile
        // 1. Pick the audio file first. Accept any format the browser can decode.
        const fileResult = await Promises.tryCatch(Files.open({
            types: [{
                description: "audio",
                accept: {"audio/*": [".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"]}
            }]
        }))
        if (!current()) {return}
        if (fileResult.status === "rejected") {return}
        const fileMaybe = fileResult.value.at(0)
        if (isAbsent(fileMaybe)) {return}
        const file: File = fileMaybe

        // 2. Lazy-load lib-inference so the model-selection dialog can show
        //    each model's actual size. The dialog is the first user-facing
        //    moment that needs the lib; loading here keeps the boot bundle
        //    free of lib-inference while still letting descriptions reflect
        //    `Inference.modelDescriptor(key).bytes`.
        const Inference = await ensureInference()
        if (!current()) {return}

        // 3. Pick a model + execution provider.
        const selectionOpt = await pickSelection(Inference, "stem-separation")
        if (!current()) {return}
        if (selectionOpt.isEmpty()) {return}
        const {model, provider} = selectionOpt.unwrap()

        // Suspend the audio context while demuxing: WebGPU shader compile + ORT
        // inference contend with the audio thread and cause dropouts otherwise.
        if (!service.hasProfile) {
            profile = new ProjectProfile(UUID.generate(), Project.new(service), ProjectMeta.init("Untitled"), Option.None)
            service.projectProfileService.setValue(Option.wrap(profile))
        }
        const project = service.project
        await withSuspendedAudio(service.audioContext, runDemux)

        async function runDemux(): Promise<void> {
            if (!current()) {return}

            // 4. Decode the audio file at 44.1 kHz.
            const decoded = await Promises.tryCatch(decodeAudioFile(file, 44100))
            if (!current()) {return}
            if (decoded.status === "rejected") {
                await RuntimeNotifier.info({headline: "AI Demux", message: `Could not decode audio: ${decoded.error}`})
                return
            }
            const {audio, channels, frames} = decoded.value

            // 5a. If a session for this task is already loaded with a different
            //     EP than the user just picked, release it so the next preload
            //     re-creates the session under the new EP.
            const previousProvider = lastProviderByTask.get(model.key)
            if (isDefined(previousProvider) && previousProvider !== provider) {
                await Inference.releaseTask(model.key)
                if (!current()) {return}
            }

            // 5b. Download dialog (only if the model is not already cached).
            const cached = await Inference.isCached(model.key)
            if (!current()) {return}
            if (!cached) {
                const dlProgress = new DefaultObservableValue<number>(0)
                const dlController = new AbortController()
                const sizeLabel = Bytes.toString(Inference.modelDescriptor(model.key).bytes)
                const dlDialog = RuntimeNotifier.progress({
                    headline: "Downloading model",
                    message: `${sizeLabel}, one-time`,
                    progress: dlProgress,
                    cancel: () => dlController.abort(Errors.AbortError)
                })
                const preloadResult = await Promises.tryCatch(Inference.preload(model.key, {
                    progress: value => dlProgress.setValue(value),
                    signal: dlController.signal,
                    executionProvider: provider
                }))
                dlDialog.terminate()
                if (!current()) {return}
                if (preloadResult.status === "rejected") {
                    if (!Errors.isAbort(preloadResult.error)) {
                        await RuntimeNotifier.info({
                            headline: "Model download failed",
                            message: String(preloadResult.error)
                        })
                    }
                    return
                }
            } else {
                // Cached: download is instant, but worker session creation takes
                // several seconds for a 300 MB model (shader compile + GPU memory
                // setup). Show an indeterminate-progress dialog so the user has
                // visual feedback during the wait.
                //
                // Cancel here can't actually interrupt InferenceSession.create
                // (ORT doesn't accept an AbortSignal at session-create time), but
                // we race the user's abort against the preload promise so cancel
                // immediately returns control to the user. The worker may keep
                // loading in the background; the next preload call will then
                // resolve instantly because the session is already in the cache.
                const loadController = new AbortController()
                const loadDialog = RuntimeNotifier.progress({
                    headline: "Loading model",
                    cancel: () => loadController.abort(Errors.AbortError)
                })
                const sessionResult = await Promises.tryCatch(Promise.race([
                    Inference.preload(model.key, {
                        signal: loadController.signal,
                        executionProvider: provider
                    }),
                    new Promise<never>((_, reject) => loadController.signal.addEventListener(
                        "abort", () => reject(Errors.AbortError), {once: true}))
                ]))
                loadDialog.terminate()
                if (!current()) {return}
                if (sessionResult.status === "rejected") {
                    if (!Errors.isAbort(sessionResult.error)) {
                        await RuntimeNotifier.info({
                            headline: "AI Demux failed",
                            message: `Could not load model session: ${sessionResult.error}`
                        })
                    }
                    return
                }
            }

            // 5b. Separate dialog. Session is loaded, so downloadShare=0 maps the
            // dialog's 0..1 directly to inference progress.
            const sepProgress = new DefaultObservableValue<number>(0)
            const sepController = new AbortController()
            const sepDialog = RuntimeNotifier.progress({
                headline: "Separating stems",
                message: `Using ${providerLabel(provider)}`,
                progress: sepProgress,
                cancel: () => sepController.abort(Errors.AbortError)
            })
            const inferenceResult = await Promises.tryCatch(Inference.run(model.key, {
                audio, channels, sampleRate: 44100
            }, {
                progress: value => sepProgress.setValue(value),
                signal: sepController.signal,
                downloadShare: 0,
                executionProvider: provider
            }))
            sepDialog.terminate()
            if (!current()) {return}

            if (inferenceResult.status === "rejected") {
                if (!Errors.isAbort(inferenceResult.error)) {
                    await RuntimeNotifier.info({
                        headline: "AI Demux failed",
                        message: String(inferenceResult.error)
                    })
                }
                return
            }

            // 6. Inference succeeded with this EP — record it so a later run with
            //    the same EP skips the release+reload, and a run with a different
            //    EP triggers it.
            lastProviderByTask.set(model.key, provider)

            // 7. Import each stem and create a Tape track per stem (mirrors importStems).
            const stems = inferenceResult.value
            const importDialog = RuntimeNotifier.progress({
                headline: "AI Demux",
                message: "Importing stems..."
            })
            const importResults: Array<{ name: StemName, sample: Sample }> = []
            const outcomes: string[] = []
            try {
                for (const stemName of STEM_NAMES) {
                    const planar = stems[stemName].subarray(0, channels * frames)
                    const arrayBuffer = WavFile.encodeInts16({
                        sampleRate: 44100,
                        length: frames,
                        numberOfChannels: channels,
                        getChannelData: (c: number) => planar.subarray(c * frames, (c + 1) * frames)
                    })
                    const importResult = await Promises.tryCatch(sampleService.importFile({
                        name: stemName,
                        arrayBuffer
                    }))
                    if (!current()) {return}
                    if (importResult.status === "rejected") {
                        outcomes.push(`${stemName}: import failed (${String(importResult.error)})`)
                        continue
                    }
                    const sample = importResult.value
                    const audioResult = await Promises.tryCatch(sampleManager.getAudioData(UUID.parse(sample.uuid)))
                    if (!current()) {return}
                    if (audioResult.status === "rejected") {
                        outcomes.push(`${stemName}: audio load failed (${String(audioResult.error)})`)
                        continue
                    }
                    outcomes.push(`${stemName}: ready`)
                    importResults.push({name: stemName, sample})
                }
            } finally {importDialog.terminate()}
            if (importResults.length !== STEM_NAMES.length) {
                await RuntimeNotifier.info({headline: "AI Demux — Incomplete Stems",
                    message: `${outcomes.join("\n")}\nNo tracks were added. Imported samples remain in the sample library. Retry separation to add the complete group.`})
                return
            }

            if (!current()) {return}
            // 7. Create the audio units inside one editing transaction.
            const {editing, boxGraph, api} = project
            editing.modify(() => {
                for (const {name, sample} of importResults) {
                    const {trackBox, instrumentBox} = api.createInstrument(InstrumentFactories.Tape)
                    instrumentBox.label.setValue(name)
                    const uuid = UUID.parse(sample.uuid)
                    const audioFileBox = boxGraph.findBox<AudioFileBox>(uuid)
                        .unwrapOrElse(() => AudioFileBox.create(boxGraph, uuid, box => {
                            box.fileName.setValue(name)
                            box.startInSeconds.setValue(0)
                            box.endInSeconds.setValue(sample.duration)
                        }))
                    AudioContentFactory.createNotStretchedRegion({
                        boxGraph, sample, audioFileBox, position: 0, targetTrack: trackBox
                    })
                }
            })
        }
    }
}