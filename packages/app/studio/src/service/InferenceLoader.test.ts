import {afterEach, expect, it, vi} from "vitest"

const {install, run, opfs} = vi.hoisted(() => ({install: vi.fn(), run: vi.fn(), opfs: {}}))
vi.mock("@opendaw/studio-core", () => ({Workers: {Opfs: opfs}}))
vi.mock("@opendaw/lib-inference", () => ({Inference: {install, run}}))
afterEach(() => {vi.resetModules(); vi.resetAllMocks()})

it("shares the complete first installation without replacing an active host", async () => {
    const {ensureInference} = await import("./InferenceLoader")
    const first = ensureInference()
    const second = ensureInference()
    const host = await first
    host.run("synthetic" as never, {} as never)
    expect(await second).toBe(host)
    expect(install).toHaveBeenCalledExactlyOnceWith({opfs})
    expect(run).toHaveBeenCalledTimes(1)
})

it("retries a failed installation once for overlapping callers", async () => {
    const error = new Error("install refused")
    install.mockImplementationOnce(() => {throw error})
    const {ensureInference} = await import("./InferenceLoader")
    const failures = await Promise.allSettled([ensureInference(), ensureInference()])
    expect(failures).toEqual([{status: "rejected", reason: error}, {status: "rejected", reason: error}])
    const [a, b] = await Promise.all([ensureInference(), ensureInference()])
    expect(a).toBe(b)
    expect(install).toHaveBeenCalledTimes(2)
})
