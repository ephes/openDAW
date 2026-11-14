import {Arrays, asDefined, Errors, isDefined, RuntimeNotifier} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"

export namespace Files {
    export const save = async (arrayBuffer: ArrayBuffer, options?: SaveFilePickerOptions): Promise<string> => {
        if (isDefined(window.showSaveFilePicker)) {
            const {status, error, value: handle} = await Promises.tryCatch(window.showSaveFilePicker(options))
            if (status === "rejected") {
                if (Errors.isNotAllowed(error)) {
                    return saveBlobFallback(arrayBuffer, options)
                }
                return RuntimeNotifier.info({
                    headline: "Could not show file picker",
                    message: String(error)
                }).then(() => Promise.reject(error))
            }
            const writeFile = async (): Promise<void> => {
                const writable = await handle.createWritable()
                await writable.truncate(0)
                await writable.write(arrayBuffer)
                await writable.close()
            }
            const {status: writeStatus, error: writeError} = await Promises.tryCatch(writeFile())
            if (writeStatus === "rejected") {
                await RuntimeNotifier.info({
                    headline: "Could not save file",
                    message: String(writeError)
                })
                return Promise.reject(writeError)
            }
            return handle.name ?? "unknown"
        } else {
            return saveBlobFallback(arrayBuffer, options)
        }
    }

    const saveBlobFallback = (arrayBuffer: ArrayBuffer, options?: SaveFilePickerOptions): string => {
        const blob = new Blob([arrayBuffer])
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = options?.suggestedName ?? `unknown`
        anchor.click()
        URL.revokeObjectURL(url)
        return options?.suggestedName ?? "Unknown"
    }

    export const open = async (options?: OpenFilePickerOptions): Promise<ReadonlyArray<File>> => {
        if (isDefined(window.showOpenFilePicker)) {
            const {status, value: fileHandles, error} = await Promises.tryCatch(window.showOpenFilePicker(options))
            if (status === "rejected") {return Promise.reject(error)}
            return Promise.all(fileHandles.map(fileHandle => fileHandle.getFile()))
        } else {
            return new Promise<ReadonlyArray<File>>((resolve, reject) => {
                if (isDefined(options)) {
                    console.warn("FileApi.showOpenFilePicker is emulated in this browser. OpenFilePickerOptions are ignored.")
                }
                const fileInput = document.createElement("input")
                let settled = false
                const finish = (files: ReadonlyArray<File> | null, error?: unknown): void => {
                    if (settled) {return}
                    settled = true
                    fileInput.removeEventListener("cancel", onCancel)
                    fileInput.removeEventListener("change", onChange)
                    fileInput.remove()
                    if (files !== null) {resolve(files)} else {reject(error)}
                }
                const onCancel = (): void => finish(null, new DOMException("cancel", "AbortError"))
                const onChange = (): void => {
                    if (settled) {return}
                    try {
                        const files = fileInput.files
                        if (isDefined(files)) {
                            finish(Arrays.create(index => asDefined(files.item(index), `No file at index ${index}`), files.length))
                        } else {onCancel()}
                    } catch (error) {finish(null, error)}
                }
                try {
                    fileInput.type = "file"
                    fileInput.multiple = options?.multiple ?? false
                    fileInput.style.display = "none"
                    fileInput.addEventListener("cancel", onCancel)
                    fileInput.addEventListener("change", onChange)
                    document.body.appendChild(fileInput)
                    fileInput.click()
                } catch (error) {finish(null, error)}
            })
        }
    }
}