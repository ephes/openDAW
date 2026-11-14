import {Arrays, asDefined, Errors, Provider, tryCatch} from "@opendaw/lib-std"
import {Communicator, Messenger, Promises} from "@opendaw/lib-runtime"
import {OpfsProtocol} from "./OpfsProtocol"

export namespace OpfsWorker {
    const DEBUG = false

    export const init = (messenger: Messenger) =>
        Communicator.executor(messenger.channel("opfs"), new class implements OpfsProtocol {
            #tail = Promise.resolve()

            async write(path: string, data: Uint8Array): Promise<void> {
                await this.#acquireLock(path, async path => {
                    if (DEBUG) {console.debug(`write ${data.length}b to ${path}`)}
                    const handle = await this.#resolveFile(path, {create: true})
                    withHandle(handle, () => {
                        handle.truncate(data.length)
                        for (let offset = 0; offset < data.byteLength;) {
                            const count = handle.write(data.subarray(offset) as Uint8Array<ArrayBuffer>, {at: offset})
                            if (!Number.isInteger(count) || count <= 0 || count > data.byteLength - offset) {
                                throw new Error("Incomplete OPFS write")
                            }
                            offset += count
                        }
                        handle.flush()
                    })
                })
            }

            async read(path: string, maxBytes = OpfsProtocol.ReadLimits.Project): Promise<Uint8Array> {
                if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {throw new Error("Invalid OPFS read budget")}
                return await this.#acquireLock(path, async path => {
                    if (DEBUG) {console.debug(`read ${path}`)}
                    const handle = await this.#resolveFile(path)
                    return withHandle(handle, () => {
                        const size = handle.getSize()
                        if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
                            throw new Error("OPFS read byte limit exceeded")
                        }
                        const buffer = new Uint8Array(size)
                        for (let offset = 0; offset < size;) {
                            const count = handle.read(buffer.subarray(offset), {at: offset})
                            if (!Number.isInteger(count) || count <= 0 || count > size - offset) {
                                throw new Error("Incomplete OPFS read")
                            }
                            offset += count
                        }
                        return buffer
                    })
                })
            }

            async exists(path: string): Promise<boolean> {
                return await this.#acquireLock(path, async path => {
                    if (DEBUG) {console.debug(`exists ${path}`)}
                    const segments = pathToSegments(path)
                    try {
                        await this.#resolveFolder(segments)
                        return true
                    } catch (error) {
                        // A file is not a directory; try the file lookup in that case.
                        if (!isMissing(error) && !(Errors.isDOMException(error) && error.name === "TypeMismatchError")) {
                            throw error
                        }
                    }
                    const result = await Promises.tryCatch(this.#resolveFile(path))
                    if (result.status === "rejected") {
                        if (isMissing(result.error)) {return false}
                        throw result.error
                    }
                    const handle = result.value
                    return withHandle(handle, () => handle.getSize() > 0)
                })
            }

            async delete(path: string): Promise<void> {
                await this.#acquireLock(path, async path => {
                    const segments = pathToSegments(path)
                    if (segments.length === 0) {return this.#clear()}
                    const result = await Promises.tryCatch(this.#resolveFolder(segments.slice(0, -1))
                        .then(folder => folder.removeEntry(asDefined(segments.at(-1)), {recursive: true})))
                    if (result.status === "rejected" && !isMissing(result.error)) {throw result.error}
                })
            }

            async list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>> {
                return this.#acquireLock(path, path => this.#list(path))
            }

            async #list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>> {
                const segments = pathToSegments(path)
                const result = await Promises.tryCatch(this.#resolveFolder(segments))
                if (result.status === "rejected") {
                    if (isMissing(result.error)) {return Arrays.empty()}
                    throw result.error
                }
                const folder = result.value
                const entries: Array<OpfsProtocol.Entry> = []
                for await (const {name, kind} of folder.values()) {
                    entries.push({name, kind})
                }
                return entries
            }

            async #clear(): Promise<void> {
                const root = await getOpfsRoot()
                for await (const [name, handle] of root.entries()) {
                    if (handle.kind === "file") {
                        await root.removeEntry(name)
                    } else if (handle.kind === "directory") {
                        await root.removeEntry(name, {recursive: true})
                    }
                }
            }

            async #acquireLock<T>(path: string, operation: (path: string) => Promise<T>): Promise<T> {
                const canonical = pathToSegments(path).join("/")
                const previous = this.#tail
                const {promise, resolve} = Promise.withResolvers<void>()
                this.#tail = promise
                await previous
                try {
                    return await operation(canonical)
                } finally {
                    resolve()
                }
            }

            async #resolveFile(path: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemSyncAccessHandle> {
                const segments = pathToSegments(path)
                const folder = await this.#resolveFolder(segments.slice(0, -1), options)
                const fileHandle = await folder.getFileHandle(asDefined(segments.at(-1)), options)
                return await fileHandle.createSyncAccessHandle()
            }

            async #resolveFolder(segments: ReadonlyArray<string>,
                                 options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
                let folder: FileSystemDirectoryHandle = await getOpfsRoot()
                for (const segment of segments) {folder = await folder.getDirectoryHandle(segment, options)}
                return folder
            }
        })

    const isMissing = (error: unknown): boolean =>
        Errors.isDOMException(error) && error.name === "NotFoundError"

    const getOpfsRoot = (): Promise<FileSystemDirectoryHandle> => navigator.storage.getDirectory()

    const withHandle = <T>(handle: FileSystemSyncAccessHandle, operation: Provider<T>): T => {
        const result = tryCatch(operation)
        const cleanup = tryCatch(() => handle.close())
        if (result.status === "failure") {
            if (cleanup.status === "failure") {
                throw new AggregateError([result.error, new Error("OPFS handle close failed")],
                    result.error instanceof Error ? result.error.message.slice(0, 300) : "OPFS operation failed",
                    {cause: result.error})
            }
            throw result.error
        }
        if (cleanup.status === "failure") {throw cleanup.error}
        return result.value
    }

    const pathToSegments = (path: string): ReadonlyArray<string> => {
        const noSlashes = path.replace(/^\/+|\/+$/g, "")
        const segments = noSlashes === "" ? [] : noSlashes.split("/")
        if (segments.some(segment => segment === "" || segment === "." || segment === ".."
            || segment.includes("\u0000") || segment.includes("\\"))) {
            throw new Error("Invalid OPFS path")
        }
        return segments
    }
}
