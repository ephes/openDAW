import {Arrays, asDefined, Errors, isNotUndefined, panic} from "@opendaw/lib-std"
import {Communicator, Messenger, Promises} from "@opendaw/lib-runtime"
import {OpfsProtocol} from "./OpfsProtocol"

export namespace OpfsWorker {
    const DEBUG = false

    export const init = (messenger: Messenger) =>
        Communicator.executor(messenger.channel("opfs"), new class implements OpfsProtocol {
            readonly #locks = new Map<string, Promise<void>>()

            async write(path: string, data: Uint8Array): Promise<void> {
                await this.#acquireLock(path, async () => {
                    if (DEBUG) {console.debug(`write ${data.length}b to ${path}`)}
                    const handle = await this.#resolveFile(path, {create: true})
                    try {
                        handle.truncate(data.length)
                        for (let offset = 0; offset < data.byteLength;) {
                            const count = handle.write(data.subarray(offset) as Uint8Array<ArrayBuffer>, {at: offset})
                            if (!Number.isInteger(count) || count <= 0 || count > data.byteLength - offset) {
                                throw new Error("Incomplete OPFS write")
                            }
                            offset += count
                        }
                        handle.flush()
                    } catch (reason: any) {
                        console.error("OPFS write failed:",
                            reason?.name, reason?.message, reason?.stack ?? "(no stack trace)")
                        throw reason
                    } finally {
                        handle.close()
                    }
                })
            }

            async read(path: string): Promise<Uint8Array> {
                return await this.#acquireLock(path, async () => {
                    if (DEBUG) {console.debug(`read ${path}`)}
                    const handle = await this.#resolveFile(path)
                    try {
                        const size = handle.getSize()
                        const buffer = new Uint8Array(size)
                        for (let offset = 0; offset < size;) {
                            const count = handle.read(buffer.subarray(offset), {at: offset})
                            if (!Number.isInteger(count) || count <= 0 || count > size - offset) {
                                throw new Error("Incomplete OPFS read")
                            }
                            offset += count
                        }
                        return buffer
                    } finally {
                        handle.close()
                    }
                })
            }

            async exists(path: string): Promise<boolean> {
                return await this.#acquireLock(path, async () => {
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
                    try {
                        return handle.getSize() > 0
                    } finally {
                        handle.close()
                    }
                })
            }

            async delete(path: string): Promise<void> {
                await this.#acquireLock(path, async () => {
                    const segments = pathToSegments(path)
                    if (segments.length === 0) {return this.clear()}
                    const result = await Promises.tryCatch(this.#resolveFolder(segments.slice(0, -1))
                        .then(folder => folder.removeEntry(asDefined(segments.at(-1)), {recursive: true})))
                    if (result.status === "rejected" && !isMissing(result.error)) {throw result.error}
                })
            }

            async list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>> {
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

            async clear(): Promise<void> {
                const root = await getOpfsRoot()
                for await (const [name, handle] of root.entries()) {
                    if (handle.kind === "file") {
                        await root.removeEntry(name)
                    } else if (handle.kind === "directory") {
                        await root.removeEntry(name, {recursive: true})
                    }
                }
            }

            async #acquireLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
                while (true) {
                    const existingLock = this.#locks.get(path)
                    if (isNotUndefined(existingLock)) {
                        await existingLock
                        continue
                    }
                    let releaseLock: () => void = () => panic("Lock not acquired")
                    const lockPromise = new Promise<void>(resolve => releaseLock = resolve)
                    this.#locks.set(path, lockPromise)
                    try {
                        return await operation()
                    } finally {
                        if (this.#locks.get(path) === lockPromise) {
                            this.#locks.delete(path)
                        }
                        releaseLock()
                    }
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

    const pathToSegments = (path: string): ReadonlyArray<string> => {
        const noSlashes = path.replace(/^\/+|\/+$/g, "")
        return noSlashes === "" ? [] : noSlashes.split("/")
    }
}