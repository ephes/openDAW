import {OpfsProtocol} from "@opendaw/lib-fusion"
import {Editing, Errors, isDefined, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {NeuralAmpModelBox} from "@opendaw/studio-boxes"
import {BoxGraph} from "@opendaw/lib-box"
import {NeuralAmpDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {Workers} from "@opendaw/studio-core"
import {selectToneUrl} from "./ToneSelection"
import {showTone3000Dialog} from "./Tone3000Dialog"

type ToneModel = { id: number, name: string, size: string, model_url: string }
type ToneResponse = { id: number, title: string, updated_at: string, models: ReadonlyArray<ToneModel> }

export type PackMeta = {
    toneId: number
    title: string
    updatedAt: string
    cacheRevision?: string
    models: ReadonlyArray<{ id: number, name: string, size: string, model_url: string }>
}

const packPath = (toneId: number): string => `tone3000/${toneId}`
const packMetaPath = (toneId: number): string => `${packPath(toneId)}/pack.json`
const modelPath = (toneId: number, revision: string, modelId: number): string =>
    `${packPath(toneId)}/revisions/${revision}/models/${modelId}.nam`
const readPackId = (packId: string): number => {
    if (!/^[1-9][0-9]*$/.test(packId) || !Number.isSafeInteger(Number(packId))) {throw new Error("Invalid pack ID")}
    return Number(packId)
}

const fetchTone = async (toneUrl: string): Promise<ToneResponse> => {
    const response = await fetch(toneUrl)
    if (!response.ok) {throw new Error(`Failed to fetch tone: ${response.status}`)}
    return response.json()
}

const downloadModel = async (modelUrl: string, signal?: AbortSignal): Promise<string> => {
    const response = await fetch(modelUrl, signal ? {signal} : undefined)
    if (!response.ok) {throw new Error(`Failed to download model: ${response.status}`)}
    return response.text()
}

const readPackMeta = async (toneId: number): Promise<PackMeta | null> => {
    const path = packMetaPath(toneId)
    if (!await Workers.Opfs.exists(path)) {return null}
    const bytes = await Workers.Opfs.read(path, OpfsProtocol.ReadLimits.Metadata)
    const meta: PackMeta = JSON.parse(new TextDecoder().decode(bytes))
    if (meta.cacheRevision !== undefined && !UUID.validateString(meta.cacheRevision)) {throw new Error("Invalid cache revision")}
    return meta
}

export const readPackMetaFromId = async (packId: string): Promise<PackMeta | null> => {
    return readPackMeta(readPackId(packId))
}

export const readModelFromPack = async (packId: string, modelId: number, signal?: AbortSignal): Promise<string> => {
    const toneId = readPackId(packId)
    signal?.throwIfAborted()
    const meta = await readPackMeta(toneId)
    signal?.throwIfAborted()
    if (meta === null) {throw new Error("Pack metadata not found")}
    const entry = meta.models.find(entry => entry.id === modelId)
    if (!isDefined(entry)) {throw new Error("Model not in pack")}
    const path = meta.cacheRevision ? modelPath(toneId, meta.cacheRevision, modelId) : null
    const checkRevision = async () => {
        signal?.throwIfAborted()
        const current = await readPackMeta(toneId)
        if (current?.updatedAt !== meta.updatedAt || current?.cacheRevision !== meta.cacheRevision) {throw Errors.AbortError}
        signal?.throwIfAborted()
    }
    if (path !== null && await Workers.Opfs.exists(path)) {
        const bytes = await Workers.Opfs.read(path, OpfsProtocol.ReadLimits.Media)
        await checkRevision()
        return new TextDecoder().decode(bytes)
    }
    if (entry.model_url.length === 0) {throw new Error("Model URL not available — re-select pack to refresh URLs")}
    const text = await downloadModel(entry.model_url, signal)
    await checkRevision()
    if (path !== null) {await Workers.Opfs.write(path, new TextEncoder().encode(text))}
    await checkRevision()
    return text
}

export const storePackToOpfs = async (tone: ToneResponse, signal?: AbortSignal): Promise<PackMeta> => {
    const toneId = tone.id
    const existingMeta = await readPackMeta(toneId)
    const meta: PackMeta = {
        toneId,
        title: tone.title,
        updatedAt: tone.updated_at,
        cacheRevision: existingMeta?.updatedAt === tone.updated_at && existingMeta.cacheRevision
            ? existingMeta.cacheRevision : crypto.randomUUID(),
        models: tone.models.map(model => ({
            id: model.id, name: model.name, size: model.size, model_url: model.model_url
        }))
    }
    signal?.throwIfAborted()
    await Workers.Opfs.write(packMetaPath(toneId), new TextEncoder().encode(JSON.stringify(meta)))
    const defaultModel = pickDefaultModel(meta)
    if (!await Workers.Opfs.exists(modelPath(toneId, meta.cacheRevision!, defaultModel.id))) {
        const text = await downloadModel(defaultModel.model_url, signal)
        await Workers.Opfs.write(modelPath(toneId, meta.cacheRevision!, defaultModel.id), new TextEncoder().encode(text))
    }
    return meta
}

const pickDefaultModel = (meta: PackMeta): PackMeta["models"][number] => {
    const standard = meta.models.find(model => model.size === "standard")
    return standard ?? meta.models[0]
}

export const scanCachedModels = async (packId: string, meta: PackMeta): Promise<ReadonlySet<number>> => {
    const toneId = readPackId(packId)
    if (!meta.cacheRevision) {return new Set()}
    const entries = await Workers.Opfs.list(`${packPath(toneId)}/revisions/${meta.cacheRevision}/models`)
        .catch(() => [] as ReadonlyArray<{name: string, kind: string}>)
    const fileNames = new Set(entries.filter(entry => entry.kind === "file").map(entry => entry.name))
    const cached = new Set<number>()
    for (const model of meta.models) {
        if (fileNames.has(`${model.id}.nam`)) {cached.add(model.id)}
    }
    return cached
}

const browseOwners = new WeakMap<NeuralAmpDeviceBoxAdapter["box"], AbortController>()

export namespace NamTone3000 {
    export const browse = (boxGraph: BoxGraph, editing: Editing, adapter: NeuralAmpDeviceBoxAdapter, signal?: AbortSignal) => {
        return async () => {
            browseOwners.get(adapter.box)?.abort(Errors.AbortError)
            const controller = new AbortController()
            browseOwners.set(adapter.box, controller)
            const retire = () => controller.abort(Errors.AbortError)
            signal?.addEventListener("abort", retire, {once: true})
            if (signal?.aborted) {retire()}
            const ownerSignal = controller.signal
            const target = adapter.box.model.targetVertex.unwrapOrNull()
            const checkOwner = () => {
                ownerSignal.throwIfAborted()
                if (browseOwners.get(adapter.box) !== controller
                    || boxGraph.findBox(adapter.box.address.uuid).unwrapOrNull() !== adapter.box
                    || adapter.box.model.targetVertex.unwrapOrNull() !== target) {throw Errors.AbortError}
            }
            const modelChange = adapter.box.model.subscribe(() => {
                if (adapter.box.model.targetVertex.unwrapOrNull() !== target) {retire()}
            })
            const deletion = adapter.box.subscribeDeletion(() => controller.abort(Errors.AbortError))
            try {
                checkOwner()
                const {status} = await Promises.tryCatch(showTone3000Dialog())
                if (status === "rejected") {return}
                checkOwner()
                const toneUrl = await selectToneUrl(ownerSignal)
                checkOwner()
                const tone = await fetchTone(toneUrl)
                checkOwner()
                if (tone.models.length === 0) {return}
                const meta = await storePackToOpfs(tone, ownerSignal)
                checkOwner()
                const defaultModel = pickDefaultModel(meta)
                const text = await readModelFromPack(meta.toneId.toString(), defaultModel.id, ownerSignal)
                checkOwner()
                const jsonBuffer = new TextEncoder().encode(text)
                const uuid = await UUID.sha256(jsonBuffer.buffer as ArrayBuffer)
                checkOwner()
                editing.modify(() => {
                    checkOwner()
                    const oldTarget = adapter.box.model.targetVertex
                    const modelBox = boxGraph.findBox<NeuralAmpModelBox>(uuid).unwrapOrElse(() =>
                        NeuralAmpModelBox.create(boxGraph, uuid, box => {
                            box.label.setValue(`${meta.title} — ${defaultModel.name}`)
                            box.model.setValue(text)
                            box.packId.setValue(meta.toneId.toString())
                        }))
                    adapter.box.model.refer(modelBox)
                    if (oldTarget.nonEmpty()) {
                        const oldVertex = oldTarget.unwrap()
                        if (oldVertex !== modelBox && oldVertex.pointerHub.isEmpty()) {
                            oldVertex.box.unstage()
                        }
                    }
                })
            } catch (error) {
                if (Errors.isAbort(error)) {return}
                console.error("Failed to load NAM model from Tone 3000:", error)
            } finally {
                deletion.terminate()
                modelChange.terminate()
                signal?.removeEventListener("abort", retire)
                if (browseOwners.get(adapter.box) === controller) {browseOwners.delete(adapter.box)}
            }
        }
    }

    export const loadModelFromPack = async (
        packId: string, modelId: number, modelName: string,
        boxGraph: BoxGraph, editing: Editing, adapter: NeuralAmpDeviceBoxAdapter,
        packTitle: string, signal?: AbortSignal
    ): Promise<void> => {
        const target = adapter.box.model.targetVertex.unwrapOrNull()
        const checkOwner = () => {
            signal?.throwIfAborted()
            if (boxGraph.findBox(adapter.box.address.uuid).unwrapOrNull() !== adapter.box
                || adapter.box.model.targetVertex.unwrapOrNull() !== target) {throw Errors.AbortError}
        }
        checkOwner()
        const text = await readModelFromPack(packId, modelId, signal)
        checkOwner()
        const jsonBuffer = new TextEncoder().encode(text)
        const uuid = await UUID.sha256(jsonBuffer.buffer as ArrayBuffer)
        checkOwner()
        editing.modify(() => {
            const oldTarget = adapter.box.model.targetVertex
            const modelBox = boxGraph.findBox<NeuralAmpModelBox>(uuid).unwrapOrElse(() =>
                NeuralAmpModelBox.create(boxGraph, uuid, box => {
                    box.label.setValue(`${packTitle} — ${modelName}`)
                    box.model.setValue(text)
                    box.packId.setValue(packId)
                }))
            adapter.box.model.refer(modelBox)
            if (oldTarget.nonEmpty()) {
                const oldVertex = oldTarget.unwrap()
                if (oldVertex !== modelBox && oldVertex.pointerHub.isEmpty()) {
                    oldVertex.box.unstage()
                }
            }
        })
    }
}
