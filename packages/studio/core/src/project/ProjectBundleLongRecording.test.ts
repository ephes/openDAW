import "../polyfill"

if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = () => reject(reader.error)
            reader.readAsArrayBuffer(this)
        })
    }
}

import {beforeEach, describe, expect, it} from "vitest"
import {asDefined, Option, UUID} from "@opendaw/lib-std"
import {BoxGraph} from "@opendaw/lib-box"
import {AudioFileBox, BoxIO, MetaDataBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import JSZip from "jszip"

import {InMemoryOpfs} from "../recording/__test_support__/InMemoryOpfs"
import {LongRecordingSession} from "../recording/LongRecordingSession"
import {LongRecordingStorage} from "../recording/LongRecordingStorage"
import {LongRecordingSource} from "../recording/LongRecordingManifest"

import {Workers} from "../Workers"

let currentOpfs: InMemoryOpfs = new InMemoryOpfs()
Object.defineProperty(Workers, "Opfs", {
    get: () => currentOpfs,
    configurable: true,
    enumerable: false
})

import {ProjectBundle} from "./ProjectBundle"
import {ProjectPaths} from "./ProjectPaths"
import type {ProjectProfile} from "./ProjectProfile"
import type {ProjectEnv} from "./ProjectEnv"

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "project-bundle",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

const recordIntoOpfs = async (
    opfs: OpfsProtocol,
    recordingId: UUID.String,
    framesPerChunk: number
): Promise<void> => {
    const storage = LongRecordingStorage.create(recordingId, opfs)
    let tick = 1000
    const session = new LongRecordingSession({
        storage,
        sampleRate: 48000,
        numberOfChannels: 2,
        framesPerChunk,
        source: exampleSource(),
        now: () => tick++
    })
    await session.arm()
    session.appendQuantum([channelOf(framesPerChunk, 0.5), channelOf(framesPerChunk, -0.5)])
    session.appendQuantum([channelOf(framesPerChunk, 0.25), channelOf(framesPerChunk, -0.25)])
    await session.stop()
}

beforeEach(() => {currentOpfs = new InMemoryOpfs()})

describe("ProjectBundle.encode wires AudioFileBox → LongRecordingBundleAdapter", () => {
    it("places long-recording manifest + chunks into recordings/<uuid>/ of the bundle ZIP", async () => {
        const recordingUuid = UUID.generate()
        const recordingId = UUID.asString(UUID.toString(recordingUuid))
        await recordIntoOpfs(currentOpfs, recordingId, 8)
        const profileUuid = UUID.generate()
        const boxGraph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
        boxGraph.beginTransaction()
        const fileBox = AudioFileBox.create(boxGraph, recordingUuid, box => {
            box.fileName.setValue(`recording-${recordingId.slice(0, 8)}`)
            box.startInSeconds.setValue(0)
            box.endInSeconds.setValue((8 * 2) / 48000)
        })
        MetaDataBox.create(boxGraph, UUID.generate(), box => {
            box.target.refer(fileBox)
            box.origin.setValue("long-recording")
            box.value.setValue(JSON.stringify({recordingId}))
        })
        boxGraph.endTransaction()
        const fakeProject = {
            boxGraph,
            sampleManager: undefined,
            soundfontManager: undefined,
            toArrayBuffer: () => ProjectSkeleton.encode(boxGraph)
        }
        const profile = {
            uuid: profileUuid,
            project: fakeProject,
            meta: {name: "encode-test", description: "", created: "", modified: "", tags: []},
            cover: Option.None
        } as unknown as ProjectProfile
        const arrayBuffer = await ProjectBundle.encode(profile, () => {})
        const reopened = await JSZip.loadAsync(arrayBuffer)
        expect(await asDefined(reopened.file("version")).async("text")).toBe("1")
        expect(reopened.file(ProjectPaths.ProjectFile)).not.toBeNull()
        expect(reopened.file(`recordings/${recordingId}/manifest.json`)).not.toBeNull()
        const chunkEntries = Object.keys(reopened.files).filter(path =>
            path.startsWith(`recordings/${recordingId}/chunks/`) && path.endsWith(".pcm"))
        expect(chunkEntries.length).toBeGreaterThan(0)
        const overviewEntries = Object.keys(reopened.files).filter(path =>
            path.startsWith(`recordings/${recordingId}/chunks/`) && path.endsWith(".overview"))
        expect(overviewEntries.length).toBeGreaterThan(0)
        const sampleEntries = Object.keys(reopened.files).filter(path =>
            path.startsWith("samples/") && !path.endsWith("/"))
        expect(sampleEntries).toHaveLength(0)
    })
})

describe("ProjectBundle.decode restores recordings/ into OPFS via LongRecordingBundleAdapter", () => {
    it("writes bundled recordings/<uuid>/manifest.json into the target OPFS during decode", async () => {
        const recordingUuid = UUID.generate()
        const recordingId = UUID.asString(UUID.toString(recordingUuid))
        const skeleton = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: true})
        const projectBytes = ProjectSkeleton.encode(skeleton.boxGraph)
        const sourceOpfs = new InMemoryOpfs()
        await recordIntoOpfs(sourceOpfs, recordingId, 8)
        const sourceDir = LongRecordingStorage.dirFor(recordingId)
        const manifestBytes = await sourceOpfs.read(`${sourceDir}/manifest.json`)
        const chunkEntries = await sourceOpfs.list(`${sourceDir}/chunks`)
        const chunkFiles = await Promise.all(chunkEntries.map(async (entry) => ({
            name: entry.name,
            bytes: await sourceOpfs.read(`${sourceDir}/chunks/${entry.name}`)
        })))
        const zip = new JSZip()
        zip.file("version", "1")
        zip.file("uuid", UUID.generate(), {binary: true})
        zip.file(ProjectPaths.ProjectFile, new Uint8Array(projectBytes), {binary: true})
        zip.file(ProjectPaths.ProjectMetaFile, JSON.stringify({name: "decode-test"}))
        zip.file(`recordings/${recordingId}/manifest.json`, manifestBytes, {binary: true})
        for (const file of chunkFiles) {
            zip.file(`recordings/${recordingId}/chunks/${file.name}`, file.bytes, {binary: true})
        }
        const arrayBuffer = await zip.generateAsync({type: "arraybuffer"})
        currentOpfs = new InMemoryOpfs()
        const stubEnv = {} as unknown as ProjectEnv
        await ProjectBundle.decode(stubEnv, arrayBuffer)
        const restoredManifestPath = `recordings/v1/${recordingId}/manifest.json`
        expect(await currentOpfs.exists(restoredManifestPath)).toBe(true)
        const restoredManifest = await currentOpfs.read(restoredManifestPath)
        expect(restoredManifest.byteLength).toBe(manifestBytes.byteLength)
        for (const file of chunkFiles) {
            const path = `recordings/v1/${recordingId}/chunks/${file.name}`
            expect(await currentOpfs.exists(path)).toBe(true)
            const restored = await currentOpfs.read(path)
            expect(restored.byteLength).toBe(file.bytes.byteLength)
        }
    })
})
