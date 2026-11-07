import {ByteArrayInput, Class, DefaultObservableValue, isAbsent, ObservableValue, Option, tryCatch, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {Box, BoxGraph} from "@opendaw/lib-box"
import {AudioFileBox, AudioUnitBox, BoxIO, SoundfontFileBox} from "@opendaw/studio-boxes"
import {AudioUnitType} from "@opendaw/studio-enums"
import {DeviceBoxUtils, InstrumentFactories, PresetHeader} from "@opendaw/studio-adapters"
import {Workers} from "../Workers"
import {readTrashedIds} from "../deletionJournal"
import {PresetMeta, PresetMetaSchema} from "./PresetMeta"

const FOLDER = "presets/user"
const INDEX_PATH = `${FOLDER}/index.json`
const TRASH_PATH = `${FOLDER}/trash.json`
const ENC = new TextEncoder()
const DEC = new TextDecoder()

const fileFor = (uuid: UUID.Bytes): string => `${FOLDER}/${UUID.toString(uuid)}.odp`

type ParsedIndex = {entries: ReadonlyArray<PresetMeta>, repair: boolean}
const parseIndex = (bytes: Uint8Array): Option<ParsedIndex> => {
    const result = tryCatch(() => JSON.parse(DEC.decode(bytes)))
    if (result.status === "failure" || !Array.isArray(result.value)) {return Option.None}
    const entries: PresetMeta[] = []
    let repair = false
    for (const record of result.value) {
        const parsed = PresetMetaSchema.safeParse(record)
        if (parsed.success) {entries.push(parsed.data as PresetMeta)} else {repair = true}
    }
    return Option.wrap({entries, repair})
}

const HEADER_SIZE = 8

type RackInspection = {name: string, instrument: InstrumentFactories.Keys}

const inspectRackBinary = (bytes: Uint8Array): Option<RackInspection> => {
    if (bytes.byteLength < HEADER_SIZE) {return Option.None}
    const headerBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + HEADER_SIZE)
    const header = new ByteArrayInput(headerBuffer)
    if (header.readInt() !== PresetHeader.MAGIC_HEADER_OPEN) {return Option.None}
    if (header.readInt() !== PresetHeader.FORMAT_VERSION) {return Option.None}
    const graph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
    const decode = tryCatch(() => graph.fromArrayBuffer(
        bytes.buffer.slice(bytes.byteOffset + HEADER_SIZE, bytes.byteOffset + bytes.byteLength), false))
    if (decode.status === "failure") {return Option.None}
    const audioUnit = graph.boxes()
        .filter((box): box is AudioUnitBox => box instanceof AudioUnitBox)
        .find(box => box.type.getValue() !== AudioUnitType.Output)
    if (isAbsent(audioUnit)) {return Option.None}
    const inputBox = audioUnit.input.pointerHub.incoming().at(0)?.box
    if (isAbsent(inputBox)) {return Option.None}
    const stripped = inputBox.name.replace(/DeviceBox$/, "")
    if (!Object.hasOwn(InstrumentFactories.Named, stripped)) {return Option.None}
    const instrument = stripped as InstrumentFactories.Keys
    const labeled = DeviceBoxUtils.isInstrumentDeviceBox(inputBox) ? inputBox.label.getValue() : ""
    const name = labeled.length > 0 ? labeled : InstrumentFactories.Named[instrument].defaultName
    return Option.wrap({name, instrument})
}

export namespace PresetStorage {
    const cache = new DefaultObservableValue<ReadonlyArray<PresetMeta>>([])

    const lock = `opendaw:storage:${FOLDER}`

    const writeAndCache = async (entries: ReadonlyArray<PresetMeta>): Promise<void> => {
        const checked = PresetMetaSchema.array().parse(entries) as ReadonlyArray<PresetMeta>
        await Workers.Opfs.write(INDEX_PATH, ENC.encode(JSON.stringify(checked)))
        cache.setValue(checked)
    }

    export const observable = (): ObservableValue<ReadonlyArray<PresetMeta>> => cache

    const readIndexOwned = async (): Promise<ReadonlyArray<PresetMeta>> => {
        const read = await Promises.tryCatch(Workers.Opfs.read(INDEX_PATH))
        const parsed = read.status === "resolved" ? parseIndex(read.value) : Option.None
        if (parsed.isEmpty()) {return rebuildIndexOwned()}
        const {entries, repair} = parsed.unwrap()
        if (repair) {return rebuildIndexOwned(entries)}
        cache.setValue(entries)
        return entries
    }

    export const readIndex = async (): Promise<ReadonlyArray<PresetMeta>> => navigator.locks.request(lock, readIndexOwned)

    export const save = async (meta: PresetMeta, data: ArrayBufferLike): Promise<void> => navigator.locks.request(lock, async () => {
        PresetMetaSchema.parse(meta)
        const trashed = await loadTrashedIds()
        const current = await readIndexOwned()
        await Workers.Opfs.write(fileFor(UUID.parse(meta.uuid)), new Uint8Array(data))
        const next = current.filter(entry => entry.uuid !== meta.uuid)
        next.push({...meta, modified: Date.now()})
        await writeAndCache(next)
        if (trashed.includes(meta.uuid)) {
            await saveTrashedIds(trashed.filter(id => id !== meta.uuid))
        }
    })

    export const load = async (uuid: UUID.Bytes): Promise<ArrayBuffer> => {
        const bytes = await Workers.Opfs.read(fileFor(uuid))
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }

    export const updateMeta = async (uuid: UUID.Bytes,
                                     update: {name: string, description: string}): Promise<void> => navigator.locks.request(lock, async () => {
        const uuidStr = UUID.toString(uuid)
        const current = await readIndexOwned()
        const next = current.map(entry =>
            entry.uuid === uuidStr ? {...entry, ...update, modified: Date.now()} as PresetMeta : entry)
        await writeAndCache(next)
    })

    export const remove = async (uuid: UUID.Bytes): Promise<void> => navigator.locks.request(lock, async () => {
        const trashed = await loadTrashedIds()
        const current = await readIndexOwned()
        const uuidStr = UUID.toString(uuid)
        if (!trashed.includes(uuidStr)) {await saveTrashedIds([...trashed, uuidStr])}
        try {await Workers.Opfs.delete(fileFor(uuid))} catch (error) {
            if (!(error instanceof DOMException) || error.name !== "NotFoundError") {throw error}
        }
        await writeAndCache(current.filter(entry => entry.uuid !== uuidStr))
    })

    export const loadTrashedIds = async (): Promise<Array<UUID.String>> => readTrashedIds(FOLDER)

    export const saveTrashedIds = async (ids: ReadonlyArray<UUID.String>): Promise<void> => {
        await Workers.Opfs.write(TRASH_PATH, ENC.encode(JSON.stringify(ids)))
    }

    export const listUsedAssets = async (
        type: Class<AudioFileBox | SoundfontFileBox>
    ): Promise<Map<UUID.String, Array<string>>> => {
        const result = new Map<UUID.String, Array<string>>()
        // Scan physical presets, including files omitted from a stale/rebuilt index.
        // The index is a listing aid, never evidence that an asset is unused.
        const files = await Workers.Opfs.list(FOLDER)
        const entries = files.filter(file => file.kind === "file" && file.name.endsWith(".odp"))
            .map(file => ({uuid: file.name.slice(0, -4) as UUID.String,
                name: cache.getValue().find(entry => `${entry.uuid}.odp` === file.name)?.name ?? file.name}))
        for (const entry of entries) {
            const read = await Promises.tryCatch(Workers.Opfs.read(fileFor(UUID.parse(entry.uuid))))
            if (read.status === "rejected") {throw new Error(`Cannot check asset usage: repair preset ${entry.uuid}`)}
            const bytes = read.value
            if (bytes.byteLength < 8) {throw new Error(`Invalid preset ${entry.uuid}`)}
            const headerBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 8)
            const header = new ByteArrayInput(headerBuffer)
            if (header.readInt() !== PresetHeader.MAGIC_HEADER_OPEN) {throw new Error(`Invalid preset ${entry.uuid}`)}
            if (header.readInt() !== PresetHeader.FORMAT_VERSION) {throw new Error(`Unsupported preset ${entry.uuid}`)}
            const graph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
            const decoded = tryCatch(() => graph.fromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset + 8, bytes.byteOffset + bytes.byteLength), false))
            if (decoded.status === "failure") {throw new Error(`Cannot decode preset ${entry.uuid}`)}
            for (const box of graph.boxes() as Iterable<Box>) {
                if (!(box instanceof type)) {continue}
                const key = UUID.toString(box.address.uuid)
                const list = result.get(key) ?? []
                if (!list.includes(entry.name)) {list.push(entry.name)}
                result.set(key, list)
            }
        }
        return result
    }

    const rebuildIndexOwned = async (retained: ReadonlyArray<PresetMeta> = []): Promise<ReadonlyArray<PresetMeta>> => {
        console.warn("PresetStorage.rebuildIndex: index missing or unreadable — rebuilding. This should never happen.")
        const entries = await Workers.Opfs.list(FOLDER)
        const recovered: Array<PresetMeta> = retained.filter(meta =>
            entries.some(entry => entry.kind === "file" && entry.name === `${meta.uuid}.odp`))
        for (const entry of entries) {
            if (entry.kind !== "file" || !entry.name.endsWith(".odp")) {continue}
            const uuidStr = entry.name.slice(0, -".odp".length) as UUID.String
            const validId = tryCatch(() => UUID.toString(UUID.parse(uuidStr)) === uuidStr)
            if (validId.status === "failure" || !validId.value || recovered.some(meta => meta.uuid === uuidStr)) {continue}
            const path = `${FOLDER}/${entry.name}`
            const read = await Promises.tryCatch(Workers.Opfs.read(path))
            if (read.status === "rejected") {
                console.warn(`PresetStorage.rebuildIndex: cannot read ${path}`, read.error)
                continue
            }
            const inspected = inspectRackBinary(read.value)
            if (inspected.isEmpty()) {
                console.warn(`PresetStorage.rebuildIndex: ${path} is not a recognised rack preset; skipping`)
                continue
            }
            const {name, instrument} = inspected.unwrap()
            recovered.push({
                category: "audio-unit",
                uuid: uuidStr,
                name,
                instrument,
                description: "",
                created: 0,
                modified: 0
            })
        }
        await writeAndCache(recovered)
        return recovered
    }
    export const rebuildIndex = async (): Promise<ReadonlyArray<PresetMeta>> => navigator.locks.request(lock, async () => {
        const read = await Promises.tryCatch(Workers.Opfs.read(INDEX_PATH))
        const parsed = read.status === "resolved" ? parseIndex(read.value) : Option.None
        return rebuildIndexOwned(parsed.map(value => value.entries).unwrapOrElse(() => []))
    })
}
