class ScriptProbe extends AudioWorkletProcessor {
    readonly options: {registry: string, uuid: string, update: number}
    constructor({processorOptions}: AudioWorkletNodeOptions) {super(); this.options = processorOptions}
    process(): boolean {
        const {registry, uuid, update} = this.options
        const entry = (globalThis as typeof globalThis & {openDAW: Record<string, Record<string, {
            update: number, create: new () => {version: number}
        }>>}).openDAW[registry][uuid]
        this.port.postMessage(entry?.update === update ? new entry.create().version : -1)
        return false
    }
}
registerProcessor("r109-script-probe", ScriptProbe)
