import {afterEach, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {SyncLogWriter} from "@opendaw/studio-core"
import type {Commit} from "@opendaw/studio-core"
import type {StudioService} from "./StudioService"
import {SyncLogService} from "./SyncLogService"

vi.mock("@opendaw/studio-core", () => ({SyncLogWriter: {attach: vi.fn()}, SyncLogReader: {}, FilePickerAcceptTypes: {ProjectSyncLog: {}}}))
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

it.each([false, true])("acknowledges file commits only after close succeeds (fail=%s)", async fail => {
    const closing = Promise.withResolvers<void>()
    const stream = {seek: vi.fn(async () => {}), write: vi.fn(async () => {}),
        close: vi.fn(() => closing.promise), abort: vi.fn(async () => {})}
    const handle = {createWritable: vi.fn(async () => stream), getFile: vi.fn(async () => ({size: 0}))}
    vi.stubGlobal("showSaveFilePicker", vi.fn(async () => handle))
    const label = {setValue: vi.fn(), setTitle: vi.fn()}
    const service = {newProject: vi.fn(async () => {}), project: {}, factoryFooterLabel: () => Option.wrap(() => label)} as unknown as StudioService
    await SyncLogService.start(service)
    const observer = vi.mocked(SyncLogWriter.attach).mock.calls.at(-1)![1]
    const bytes = new ArrayBuffer(1)
    const writing = Promise.resolve(observer({serialize: () => bytes} as Commit))
    const outcome = fail ? expect(writing).rejects.toThrow("synthetic disk failure") : expect(writing).resolves.toBeUndefined()
    for (let i = 0; i < 8; i++) {await Promise.resolve()}
    expect(label.setValue).not.toHaveBeenCalled()
    if (fail) {closing.reject(new Error("synthetic disk failure"))} else {closing.resolve()}
    await outcome
    expect(label.setValue).toHaveBeenCalledTimes(fail ? 0 : 1)
    expect(stream.abort).toHaveBeenCalledTimes(fail ? 1 : 0)
    expect(stream.write).toHaveBeenCalledWith(bytes)
})
