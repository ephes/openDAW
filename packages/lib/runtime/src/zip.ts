import type {JSZipObject, JSZipStreamHelper} from "jszip"

export interface ZipLimits {entries: number, metadata: number, media: number, total: number, project?: number}

/** Actual expanded-byte limits; archive declarations are never used as authority. */
export const ZIP_LIMITS: ZipLimits = {entries: 1024, metadata: 1_048_576, media: 536_870_912, total: 1_073_741_824, project: 33_554_432}

export const readZipEntry = (entry: JSZipObject | null | undefined, limit: number, budget: {remaining: number}): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
        if (!entry) {reject(new Error("Missing archive entry")); return}
        const chunks: Uint8Array[] = []
        let length = 0
        let done = false
        // Public API omitted by JSZip 3.10's bundled types:
        // https://stuk.github.io/jszip/documentation/api_zipobject/internal_stream.html
        const stream = (entry as JSZipObject & {
            internalStream(type: "uint8array"): JSZipStreamHelper<Uint8Array>
        }).internalStream("uint8array")
        stream.on("data", chunk => {
            if (done) {return}
            if (chunk.byteLength > limit - length || chunk.byteLength > budget.remaining) {
                done = true
                chunks.length = 0
                stream.pause()
                reject(new Error("Archive expanded-byte limit exceeded"))
                return
            }
            length += chunk.byteLength
            budget.remaining -= chunk.byteLength
            chunks.push(chunk)
        }).on("error", () => {
            if (done) {return}
            done = true
            chunks.length = 0
            reject(new Error("Could not extract archive entry"))
        }).on("end", () => {
            if (done) {return}
            done = true
            const bytes = new Uint8Array(length)
            let offset = 0
            for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength}
            chunks.length = 0
            resolve(bytes)
        }).resume()
    })
