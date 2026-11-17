import {OpfsProtocol} from "@opendaw/lib-fusion"
import {Editing, Errors, isDefined, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {NeuralAmpModelBox} from "@opendaw/studio-boxes"
import {BoxGraph} from "@opendaw/lib-box"
import {NeuralAmpDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {Workers} from "@opendaw/studio-core"
import {selectToneUrl} from "./ToneSelection"
import {showTone3000Dialog} from "./Tone3000Dialog"

import {admitModel, admitTone, downloadModel, fetchTone, ToneResponse, ToneTransferLimits} from "./ToneTransfer"
export {downloadModel, fetchTone} from "./ToneTransfer"

export type PackMeta = {
    toneId: number
    title: string
    updatedAt: string
    cacheRevision?: string
    cacheFormat?: 1
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

/** The stored manifest bytes are unreadable or no longer admissible (not a storage failure). */
class InvalidPackManifest extends Error {}

const parsePackMeta = (toneId: number, bytes: Uint8Array): PackMeta => {
    try {
        const meta: PackMeta = JSON.parse(new TextDecoder().decode(bytes))
        const admitted = admitTone({id: meta?.toneId, title: meta?.title, updated_at: meta?.updatedAt, models: meta?.models})
        if (admitted.id !== toneId) {throw new Error("Mismatched cached pack")}
        if (meta.cacheFormat !== undefined && meta.cacheFormat !== 1) {throw new Error("Unsupported cached pack")}
        if (meta.cacheFormat === 1 && !meta.cacheRevision) {throw new Error("Missing cached pack revision")}
        if (meta.cacheRevision !== undefined && !UUID.validateString(meta.cacheRevision)) {throw new Error("Invalid cache revision")}
        return meta
    } catch (error) {
        throw new InvalidPackManifest(error instanceof Error ? error.message : "Invalid cached pack", {cause: error})
    }
}

const readPackMeta = async (toneId: number, requireComplete = true): Promise<PackMeta | null> => {
    const path = packMetaPath(toneId)
    if (!await Workers.Opfs.exists(path)) {return null}
    const bytes = await Workers.Opfs.read(path, OpfsProtocol.ReadLimits.Metadata)
    const meta = parsePackMeta(toneId, bytes)
    if (requireComplete && meta.cacheFormat === 1 && !await Workers.Opfs.exists(modelPath(toneId, meta.cacheRevision!, pickDefaultModel(meta).id))) {
        throw new Error("Incomplete cached pack — re-select pack to recover")
    }
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
    const path = meta.cacheFormat === 1 && meta.cacheRevision ? modelPath(toneId, meta.cacheRevision, modelId) : null
    const checkRevision = async () => {
        signal?.throwIfAborted()
        const current = await readPackMeta(toneId)
        if (current?.updatedAt !== meta.updatedAt || current?.cacheRevision !== meta.cacheRevision) {throw Errors.AbortError}
        signal?.throwIfAborted()
    }
    if (path !== null && await Workers.Opfs.exists(path)) {
        const bytes = await Workers.Opfs.read(path, ToneTransferLimits.Model)
        await checkRevision()
        return admitModel(new TextDecoder("utf-8", {fatal: true}).decode(bytes))
    }
    if (entry.model_url.length === 0) {throw new Error("Model URL not available — re-select pack to refresh URLs")}
    const text = await downloadModel(entry.model_url, signal)
    await checkRevision()
    if (path !== null) {
        await navigator.locks.request(`opendaw:tone3000:${toneId}`, {signal}, async () => {
            await checkRevision()
            await Workers.Opfs.writeAtomic(path, new TextEncoder().encode(text))
        })
    }
    await checkRevision()
    return text
}

export const storePackToOpfs = async (input: ToneResponse, signal?: AbortSignal): Promise<PackMeta> => {
    const tone = admitTone(input)
    return navigator.locks.request(`opendaw:tone3000:${tone.id}`, {signal}, async () => {
        signal?.throwIfAborted()
        // An unreadable or no longer admissible manifest (truncated by an older
        // non-atomic write, or a legacy pack) must not block re-selection: treat it
        // as absent so the fresh pack replaces it and its revisions are recovered.
        // Storage failures still propagate, so a current revision is never discarded.
        const existingMeta = await readPackMeta(tone.id, false).catch((error: unknown) => {
            if (error instanceof InvalidPackManifest) {return null}
            throw error
        })
        const revisions = `${packPath(tone.id)}/revisions`
        // Only the current complete revision survives recovery; abandoned staging
        // is removed before allocating another revision, under an origin-wide lock.
        for (const entry of await Workers.Opfs.list(revisions)) {
            if (entry.kind === "directory" && entry.name !== existingMeta?.cacheRevision) {
                await Workers.Opfs.delete(`${revisions}/${entry.name}`)
            }
        }
        const same = existingMeta?.cacheFormat === 1 && existingMeta.updatedAt === tone.updated_at
        const revision = same ? existingMeta.cacheRevision! : crypto.randomUUID()
        const meta: PackMeta = {toneId: tone.id, title: tone.title, updatedAt: tone.updated_at,
            cacheRevision: revision, cacheFormat: 1, models: tone.models}
        const defaultModel = pickDefaultModel(meta)
        const manifest = new TextEncoder().encode(JSON.stringify(meta))
        if (manifest.byteLength > ToneTransferLimits.Metadata) {throw new Error("Tone3000 metadata byte limit exceeded")}
        try {
            const path = modelPath(tone.id, revision, defaultModel.id)
            if (!same || !await Workers.Opfs.exists(path)) {
                const data = await downloadModel(defaultModel.model_url, signal)
                signal?.throwIfAborted()
                await Workers.Opfs.writeAtomic(path, new TextEncoder().encode(data))
            }
            signal?.throwIfAborted()
            await Workers.Opfs.writeAtomic(packMetaPath(tone.id), manifest)
            return meta
        } catch (error) {
            // A close failure may have published. Never delete a potentially
            // current complete revision; a future attempt recovers unused staging.
            try {
                if (!same && (await readPackMeta(tone.id, false))?.cacheRevision !== revision) {
                    await Workers.Opfs.delete(`${revisions}/${revision}`)
                }
            } catch { /* Keep uncertain bytes for recovery under the next lock. */ }
            throw error
        }
    })
}

const pickDefaultModel = (meta: PackMeta): PackMeta["models"][number] => {
    const standard = meta.models.find(model => model.size === "standard")
    return standard ?? meta.models[0]
}

export const scanCachedModels = async (packId: string, meta: PackMeta): Promise<ReadonlySet<number>> => {
    const toneId = readPackId(packId)
    if (meta.cacheFormat !== 1 || !meta.cacheRevision) {return new Set()}
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
                const tone = await fetchTone(toneUrl, ownerSignal)
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
