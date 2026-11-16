import {asInstanceOf, Editing, isDefined, UUID} from "@opendaw/lib-std"
import {BoxGraph, Field, StringField} from "@opendaw/lib-box"
import {Pointers} from "@opendaw/studio-enums"
import {WerkstattParameterBox, WerkstattSampleBox} from "@opendaw/studio-boxes"
import {ParamDeclaration, SampleDeclaration, ScriptDeclaration} from "./ScriptDeclaration"
import {DeviceBox} from "./DeviceBox"

const COMPILER_VERSION = 1

const createHeaderPattern = (tag: string): RegExp => new RegExp(`^// @${tag} (\\w+) (\\d+) (\\d+)\n`)

const parseHeader = (source: string, pattern: RegExp): { userCode: string, update: number } => {
    const match = source.match(pattern)
    return match !== null ? {
        userCode: source.slice(match[0].length),
        update: parseInt(match[3])
    } : {
        userCode: source,
        update: 0
    }
}

const reconcileParameters = (deviceBox: ScriptCompiler.ScriptDeviceBox, declared: ReadonlyArray<ParamDeclaration>, order: Map<string, number>, previousDeclarations: Map<string, ParamDeclaration>): void => {
    const boxGraph = deviceBox.graph
    const existingPointers = deviceBox.parameters.pointerHub.filter()
    const existingByLabel = new Map<string, WerkstattParameterBox>()
    for (const pointer of existingPointers) {
        const paramBox = asInstanceOf(pointer.box, WerkstattParameterBox)
        existingByLabel.set(paramBox.label.getValue(), paramBox)
    }
    const seen = new Set<string>()
    for (const {label} of declared) {seen.add(label)}
    for (const [label, paramBox] of existingByLabel) {
        if (!seen.has(label)) {
            paramBox.delete()
        }
    }
    seen.clear()
    for (const declaration of declared) {
        if (seen.has(declaration.label)) {continue}
        seen.add(declaration.label)
        const unifiedIndex = order.get(declaration.label) ?? 0
        const existing = existingByLabel.get(declaration.label)
        const previous = previousDeclarations.get(declaration.label)
        const declarationChanged = !isDefined(previous) || !ScriptDeclaration.hasSameDomain(previous, declaration)
        if (isDefined(existing) && declarationChanged) {
            existing.delete()
            existingByLabel.delete(declaration.label)
        }
        const current = existingByLabel.get(declaration.label)
        if (isDefined(current)) {
            current.defaultValue.setValue(declaration.defaultValue)
            if (current.index.getValue() !== unifiedIndex) {
                current.index.setValue(unifiedIndex)
            }
        } else {
            WerkstattParameterBox.create(boxGraph, UUID.generate(), paramBox => {
                paramBox.owner.refer(deviceBox.parameters)
                paramBox.label.setValue(declaration.label)
                paramBox.index.setValue(unifiedIndex)
                paramBox.value.setValue(declaration.defaultValue)
                paramBox.defaultValue.setValue(declaration.defaultValue)
            })
        }
    }
}

const reconcileSamples = (deviceBox: ScriptCompiler.ScriptDeviceBox, declared: ReadonlyArray<SampleDeclaration>, order: Map<string, number>): void => {
    const boxGraph = deviceBox.graph
    const existingPointers = deviceBox.samples.pointerHub.filter()
    const existingByLabel = new Map<string, WerkstattSampleBox>()
    for (const pointer of existingPointers) {
        const sampleBox = asInstanceOf(pointer.box, WerkstattSampleBox)
        existingByLabel.set(sampleBox.label.getValue(), sampleBox)
    }
    const seen = new Set<string>()
    for (const {label} of declared) {seen.add(label)}
    for (const [label, sampleBox] of existingByLabel) {
        if (!seen.has(label)) {
            sampleBox.file.targetVertex.ifSome(({box: fileBox}) => {
                const mustDelete = fileBox.pointerHub.size() === 1
                sampleBox.file.defer()
                if (mustDelete) {fileBox.delete()}
            })
            sampleBox.delete()
        }
    }
    seen.clear()
    for (const declaration of declared) {
        if (seen.has(declaration.label)) {continue}
        seen.add(declaration.label)
        const unifiedIndex = order.get(declaration.label) ?? 0
        const existing = existingByLabel.get(declaration.label)
        if (isDefined(existing)) {
            if (existing.index.getValue() !== unifiedIndex) {
                existing.index.setValue(unifiedIndex)
            }
        } else {
            WerkstattSampleBox.create(boxGraph, UUID.generate(), sampleBox => {
                sampleBox.owner.refer(deviceBox.samples)
                sampleBox.label.setValue(declaration.label)
                sampleBox.index.setValue(unifiedIndex)
            })
        }
    }
}

// Request ownership is shared by compiler instances and independent of saved update numbers.
let requestSerial = 0
let maxUpdate = 0
const requests = new WeakMap<BaseAudioContext, Map<string, number>>()

const claimRequest = (audioContext: BaseAudioContext, config: ScriptCompiler.Config, deviceBox: ScriptCompiler.ScriptDeviceBox): number => {
    const owners = requests.get(audioContext) ?? new Map<string, number>()
    requests.set(audioContext, owners)
    const request = ++requestSerial
    owners.set(config.registryName + ":" + UUID.toString(deviceBox.address.uuid), request)
    return request
}

const installationState = (config: ScriptCompiler.Config, uuid: string): string => `
    globalThis.openDAW ??= {}
    globalThis.openDAW.scriptInstallations ??= {}
    const state = globalThis.openDAW.scriptInstallations[${JSON.stringify(config.registryName + ":" + uuid)}]
        ??= {request: 0, attempts: {}}
    const registry = globalThis.openDAW[${JSON.stringify(config.registryName)}] ??= {}
`

const wrapCode = (config: ScriptCompiler.Config, uuid: string, update: number, request: number, userCode: string): string => `
    ${installationState(config, uuid)}
    if (${request} >= state.request) {
        state.request = ${request}
        const create = (function ${config.functionName}() {
            ${userCode}
            return Processor
        })()
        if (typeof create !== "function") {throw new Error("Script must declare a Processor constructor")}
        state.attempts[${request}] = {update: ${update}, create}
    }
`

const activateCode = (config: ScriptCompiler.Config, uuid: string, request: number): string => `
    ${installationState(config, uuid)}
    const candidate = state.attempts[${request}]
    if (state.request === ${request} && candidate) {
        candidate.activation = {update: candidate.update, create: candidate.create, request: ${request},
            previous: registry["${uuid}"], retired: false}
        registry["${uuid}"] = candidate.activation
    }
`

const settleCode = (config: ScriptCompiler.Config, uuid: string, request: number, restore: boolean): string => `
    ${installationState(config, uuid)}
    const candidate = state.attempts[${request}]
    if (candidate?.activation) {
        const activation = candidate.activation
        if (${restore}) {
            activation.retired = true
            if (registry["${uuid}"] === activation) {
                let previous = activation.previous
                while (previous?.retired) {previous = previous.previous}
                if (previous) {registry["${uuid}"] = previous}
                else {delete registry["${uuid}"]}
            }
        } else {delete activation.previous}
    }
    delete state.attempts[${request}]
`

const validateCode = (wrappedCode: string): void => {new Function(wrappedCode)}

const registerWorklet = async (audioContext: BaseAudioContext, wrappedCode: string): Promise<void> => {
    const blob = new Blob([wrappedCode], {type: "application/javascript"})
    const blobUrl = URL.createObjectURL(blob)
    try {
        await audioContext.audioWorklet.addModule(blobUrl)
    } finally {
        URL.revokeObjectURL(blobUrl)
    }
}

const install = async (audioContext: BaseAudioContext, config: ScriptCompiler.Config,
                       deviceBox: ScriptCompiler.ScriptDeviceBox, request: number, update: number, userCode: string,
                       publish: () => void): Promise<void> => {
    const uuid = UUID.toString(deviceBox.address.uuid)
    const key = config.registryName + ":" + uuid
    const savedCode = deviceBox.code.getValue()
    let sourceChanged = false
    const current = () => requests.get(audioContext)?.get(key) === request && !sourceChanged
        && deviceBox.code.getValue() === savedCode
        && deviceBox.graph.findBox(deviceBox.address.uuid).unwrapOrNull() === deviceBox
    const wrappedCode = wrapCode(config, uuid, update, request, userCode)
    validateCode(wrappedCode)
    const subscription = deviceBox.code.subscribe(() => {sourceChanged = true})
    let published = false
    let failed = false
    let failure: unknown
    try {
        await registerWorklet(audioContext, wrappedCode)
        if (current()) {
            await registerWorklet(audioContext, activateCode(config, uuid, request))
            if (current()) {
                publish()
                published = true
            }
        }
    } catch (error) {
        failed = true
        failure = error
    }
    subscription.terminate()
    // Restore only this attempt's registry entry; never undo another request's publication.
    // Successful publication must not be reported as a compile failure on cleanup refusal.
    try {
        await registerWorklet(audioContext, settleCode(config, uuid, request, !published))
    } catch (error) {
        if (published) {console.warn("Script installation cleanup failed", error)}
        else if (failed) {throw new AggregateError([failure, error], "Script installation and retirement failed", {cause: failure})}
        else {throw error}
    }
    if (failed) {throw failure}
}

export namespace ScriptCompiler {
    export interface ScriptDeviceBox extends DeviceBox {
        readonly graph: BoxGraph
        readonly code: StringField
        readonly parameters: Field<Pointers.Parameter>
        readonly samples: Field<Pointers.Sample>
    }

    export type Config = {
        readonly headerTag: string
        readonly registryName: string
        readonly functionName: string
    }

    export const create = (config: Config) => {
        const headerPattern = createHeaderPattern(config.headerTag)
        const createHeader = (update: number): string =>
            `// @${config.headerTag} js ${COMPILER_VERSION} ${update}\n`
        return {
            stripHeader: (source: string): string => parseHeader(source, headerPattern).userCode,
            load: async (audioContext: BaseAudioContext, deviceBox: ScriptDeviceBox): Promise<void> => {
                const request = claimRequest(audioContext, config, deviceBox)
                const {userCode, update} = parseHeader(deviceBox.code.getValue(), headerPattern)
                if (update === 0) {return}
                ScriptDeclaration.parseParams(userCode)
                ScriptDeclaration.parseSamples(userCode)
                return install(audioContext, config, deviceBox, request, update, userCode, () => {})
            },
            compile: async (audioContext: BaseAudioContext,
                            editing: Editing,
                            deviceBox: ScriptDeviceBox,
                            source: string,
                            append: boolean = false): Promise<void> => {
                const request = claimRequest(audioContext, config, deviceBox)
                const userCode = parseHeader(source, headerPattern).userCode
                const currentUpdate = parseHeader(deviceBox.code.getValue(), headerPattern).update
                maxUpdate = Math.max(maxUpdate, currentUpdate)
                const newUpdate = maxUpdate + 1
                maxUpdate = newUpdate
                const params = ScriptDeclaration.parseParams(userCode)
                const samples = ScriptDeclaration.parseSamples(userCode)
                const order = ScriptDeclaration.parseDeclarationOrder(userCode)
                const label = ScriptDeclaration.parseLabel(userCode)
                const modifier = () => {
                    const previousDeclarations = new Map(ScriptDeclaration.parseParams(deviceBox.code.getValue())
                        .map(declaration => [declaration.label, declaration]))
                    deviceBox.code.setValue(createHeader(newUpdate) + userCode)
                    label.ifSome(name => deviceBox.label.setValue(name))
                    reconcileParameters(deviceBox, params, order, previousDeclarations)
                    reconcileSamples(deviceBox, samples, order)
                }
                return install(audioContext, config, deviceBox, request, newUpdate, userCode, () => {
                    if (append) {editing.append(modifier)} else {editing.modify(modifier)}
                })
            }
        }
    }
}
