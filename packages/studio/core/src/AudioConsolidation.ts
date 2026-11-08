import {Arrays, Errors, Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {AudioData, RegionCollection, WavFile} from "@opendaw/lib-dsp"
import {AudioRegionBoxAdapter, ExportConfiguration} from "@opendaw/studio-adapters"
import {
    AudioContentFactory,
    AudioFileBoxFactory,
    OfflineEngineRenderer,
    Project,
    SampleService,
    Workers
} from "./index"

export namespace AudioConsolidation {
    export const flatten = async (project: Project,
                                  sampleService: SampleService,
                                  regions: ReadonlyArray<AudioRegionBoxAdapter>,
                                  abortSignal?: AbortSignal): Promise<void> => {
        if (regions.length === 0) {return}
        const sorted = regions.toSorted(RegionCollection.Comparator)
        const first = Arrays.getFirst(sorted, "No first region")
        const rangeMin = first.position
        const rangeMax = sorted.reduce((end, region) => Math.max(end, region.complete), first.complete)
        const trackBoxAdapter = first.trackBoxAdapter.unwrap("Has no trackAdapter")
        const audioUnitUuid = UUID.toString(trackBoxAdapter.audioUnit.address.uuid)
        const sampleRate = sampleService.audioContext.sampleRate
        const durationSeconds = project.tempoMap.intervalToSeconds(rangeMin, rangeMax)
        const numSamples = Math.ceil(durationSeconds * sampleRate)
        const exportConfiguration: ExportConfiguration = {
            stems: {
                [audioUnitUuid]: {
                    includeAudioEffects: false,
                    includeSends: false,
                    useInstrumentOutput: true,
                    fileName: `Merged ${first.file.fileName}`
                }
            }
        }
        const selectedUuids = UUID.newSet<UUID.Bytes>(uuid => uuid)
        sorted.forEach(region => selectedUuids.add(region.uuid))
        const allRegionsInRange = trackBoxAdapter.regions.collection.asArray()
            .filter(region => region.position < rangeMax && region.complete > rangeMin)
        const nonSelectedUuids = allRegionsInRange
            .filter(region => !selectedUuids.hasKey(region.uuid))
            .map(region => region.uuid)
        const abortController = new AbortController()
        const signal = abortController.signal
        const incomingAbort = () => abortController.abort()
        abortSignal?.addEventListener("abort", incomingAbort, {once: true})
        if (abortSignal?.aborted) {abortController.abort()}
        const checkCancelled = () => {if (signal.aborted) {throw Errors.AbortError}}
        // Any graph edit can alter the render (including tempo, automation or routing).
        // Refuse conservatively rather than overwrite edits made while flatten waits.
        let sourceChanged = false
        const sourceSubscription = project.boxGraph.subscribeToAllUpdates({onUpdate: () => {sourceChanged = true}})
        const checkSource = () => {
            if (sourceChanged || !trackBoxAdapter.box.isAttached() || sorted.some(region => !region.box.isAttached())) {
                throw new Error("Source changed while flattening. Please retry with the current regions.")
            }
        }
        let failure: {error: unknown} | undefined
        let copiedProject: Project | undefined
        let renderer: OfflineEngineRenderer | undefined
        let dialog: ReturnType<typeof RuntimeNotifier.progress> | undefined
        const aborted = Promise.withResolvers<never>()
        // Install a rejection observer even when cancellation arrives between stages.
        void aborted.promise.catch(() => {})
        const cancel = () => {
            aborted.reject(Errors.AbortError)
            if (renderer !== undefined) {
                renderer.stop()
                renderer.terminate()
                renderer = undefined
            }
        }
        signal.addEventListener("abort", cancel, {once: true})
        const wait = async <T>(promise: Promise<T>): Promise<T> => {
            const result = await Promise.race([promise, aborted.promise])
            checkCancelled()
            return result
        }
        try {
            checkCancelled()
            copiedProject = project.copy()
            copiedProject.boxGraph.beginTransaction()
            nonSelectedUuids.forEach(uuid => copiedProject!.boxGraph.findBox(uuid).ifSome(box => box.delete()))
            copiedProject.boxGraph.endTransaction()
            dialog = RuntimeNotifier.progress({headline: "Flattening Audio Regions...", cancel: incomingAbort})
            const creating = OfflineEngineRenderer.create(copiedProject, Option.wrap(exportConfiguration), sampleRate)
                .then(created => {
                    if (signal.aborted) {created.terminate(); throw Errors.AbortError}
                    return renderer = created
                })
            const active = await wait(creating)
            await wait(active.waitForLoading())
            active.setPosition(rangeMin)
            await wait(active.play())
            await wait(active.waitForLoading())
            const channels = await wait(active.step(numSamples))
            const audioData = AudioData.create(sampleRate, numSamples, 2)
            audioData.frames[0].set(channels[0])
            audioData.frames[1].set(channels[1])
            checkSource()
            dialog.message = "Importing sample..."
            const sample = await wait(sampleService.importFile({name: "flatten", arrayBuffer: WavFile.encodeFloats(audioData)}))
            const sampleUuid = UUID.parse(sample.uuid)
            const audioFileBoxModifier = await wait(AudioFileBoxFactory.createModifier(
                Workers.Transients, project.boxGraph, audioData, sampleUuid, sample.name))
            checkCancelled()
            checkSource()
            project.editing.modify(() => {
                const audioFileBox = audioFileBoxModifier()
                sorted.forEach(region => region.box.delete())
                AudioContentFactory.createNotStretchedRegion({
                    boxGraph: project.boxGraph,
                    targetTrack: trackBoxAdapter.box,
                    audioFileBox,
                    sample,
                    position: rangeMin,
                    name: first.label
                })
                project.trackUserCreatedSample(sampleUuid)
            })
        } catch (error) {
            if (!Errors.isAbort(error)) {
                failure = {error}
            }
        } finally {
            abortSignal?.removeEventListener("abort", incomingAbort)
            signal.removeEventListener("abort", cancel)
            sourceSubscription.terminate()
            renderer?.terminate()
            copiedProject?.terminate()
            dialog?.terminate()
        }
        if (failure !== undefined) {
            await RuntimeNotifier.info({headline: "Flatten Failed", message: String(failure.error)})
        }
    }
}
