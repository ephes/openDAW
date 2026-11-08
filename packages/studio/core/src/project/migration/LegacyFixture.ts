import {vi} from "vitest"
import {Field} from "@opendaw/lib-box"
import {BoxAdapters, BoxAdaptersContext, ParameterFieldAdapters, ProjectSkeleton} from "@opendaw/studio-adapters"

// Emulate the historical schema's writable fields while producing real project bytes.
// Current serialization intentionally omits fields that are now deprecated.
export const legacyBytes = (skeleton: ProjectSkeleton, fields: ReadonlyArray<Field>): ArrayBufferLike => {
    const spies = fields.map(field => vi.spyOn(field, "deprecated", "get").mockReturnValue(false))
    try { return ProjectSkeleton.encode(skeleton.boxGraph) }
    finally { spies.forEach(spy => spy.mockRestore()) }
}

// Only these services are used by the synchronous adapters under test.
export const adapterContext = (skeleton: ProjectSkeleton): BoxAdaptersContext => {
    const context = {
        boxGraph: skeleton.boxGraph,
        parameterFieldAdapters: new ParameterFieldAdapters(),
        isMainThread: false
    } as BoxAdaptersContext
    Object.defineProperty(context, "boxAdapters", {value: new BoxAdapters(context)})
    return context
}
