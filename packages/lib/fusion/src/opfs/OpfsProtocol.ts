export namespace OpfsProtocol {
    export const ReadLimits = Object.freeze({Metadata: 1024 * 1024, Project: 64 * 1024 * 1024,
        Preset: 16 * 1024 * 1024, Media: 1024 * 1024 * 1024})
    export type Kind = "file" | "directory"
    export type Entry = { name: string, kind: Kind }
}

export interface OpfsProtocol {
    writeAtomic(path: string, data: Uint8Array): Promise<void>
    write(path: string, data: Uint8Array): Promise<void>
    read(path: string, maxBytes?: number): Promise<Uint8Array>
    exists(path: string): Promise<boolean>
    delete(path: string): Promise<void>
    list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>>
}
