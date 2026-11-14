// @vitest-environment node
import {expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {OpenSampleAPI} from "./OpenSampleAPI"
import {SampleStorage} from "./SampleStorage"
import {SampleService} from "./SampleService"

vi.mock("./OpenSampleAPI", () => ({OpenSampleAPI: {get: vi.fn()}}))
vi.mock("./SampleStorage", () => ({SampleStorage: {get: vi.fn()}}))
vi.mock("../Workers", () => ({Workers: {}}))

it("opens projects while the stock catalog is unreachable", async () => {
    vi.mocked(OpenSampleAPI.get).mockReturnValue({all: () => Promise.reject(new Error("offline"))} as never)
    vi.mocked(SampleStorage.get).mockReturnValue({list: () => Promise.resolve([])} as never)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const service = new SampleService({} as AudioContext)
    await expect(service.replaceMissingFiles(new BoxGraph(), {invalidate: vi.fn()})).resolves.toBeUndefined()
})
