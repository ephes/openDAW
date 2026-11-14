// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {AssetService} from "../AssetService"
import {OpenSampleAPI} from "./OpenSampleAPI"
import {SampleStorage} from "./SampleStorage"
import {SampleService} from "./SampleService"

vi.mock("./OpenSampleAPI", () => ({OpenSampleAPI: {get: vi.fn()}}))
vi.mock("./SampleStorage", () => ({SampleStorage: {get: vi.fn()}}))
vi.mock("../Workers", () => ({Workers: {}}))
afterEach(() => {vi.restoreAllMocks()})

it("opens projects while the stock catalog is unreachable without missing-sample prompts", async () => {
    vi.mocked(OpenSampleAPI.get).mockReturnValue({all: () => Promise.reject(new Error("offline"))} as never)
    vi.mocked(SampleStorage.get).mockReturnValue({list: () => Promise.resolve([])} as never)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const check = vi.spyOn(AssetService.prototype, "replaceMissingFiles")
    const service = new SampleService({} as AudioContext)
    await expect(service.replaceMissingFiles(new BoxGraph(), {invalidate: vi.fn()})).resolves.toBeUndefined()
    expect(check).not.toHaveBeenCalled()
})

it("checks for missing samples when the stock catalog is available", async () => {
    vi.mocked(OpenSampleAPI.get).mockReturnValue({all: () => Promise.resolve([])} as never)
    vi.mocked(SampleStorage.get).mockReturnValue({list: () => Promise.resolve([])} as never)
    const check = vi.spyOn(AssetService.prototype, "replaceMissingFiles")
    const service = new SampleService({} as AudioContext)
    await service.replaceMissingFiles(new BoxGraph(), {invalidate: vi.fn()})
    expect(check).toHaveBeenCalledTimes(1)
})
