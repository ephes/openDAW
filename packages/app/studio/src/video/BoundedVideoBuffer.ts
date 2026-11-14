export const MAX_BUFFERED_VIDEO_BYTES = 256 * 1024 * 1024
export const BUFFERED_VIDEO_LIMIT_MESSAGE = "Buffered video exceeds 256 MiB. Use a shorter duration or direct file streaming in Chrome."

/** Seekable storage for StreamTarget writes. Header rewrites replace existing bytes. */
export class BoundedVideoBuffer {
    readonly #limit: number
    #bytes: Uint8Array<ArrayBuffer> = new Uint8Array(0)
    #size = 0
    #retired = false

    constructor(limit = MAX_BUFFERED_VIDEO_BYTES) {
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_BUFFERED_VIDEO_BYTES) {throw new Error("Invalid video byte limit.")}
        this.#limit = limit
    }

    write({position, data}: {position: number, data: Uint8Array}): void {
        if (this.#retired) {throw new Error("Video buffer is retired.")}
        const end = position + data.byteLength
        if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(end) || end > this.#limit) {
            this.clear()
            throw new Error(BUFFERED_VIDEO_LIMIT_MESSAGE)
        }
        if (end > this.#bytes.length) {
            const bytes = new Uint8Array(Math.min(this.#limit, Math.max(end, 1024 * 1024, this.#bytes.length * 2)))
            bytes.set(this.#bytes)
            this.#bytes = bytes
        }
        this.#bytes.set(data, position)
        this.#size = Math.max(this.#size, end)
    }

    finish(): ArrayBuffer {
        if (this.#retired) {throw new Error("Video buffer is retired.")}
        return this.#bytes.slice(0, this.#size).buffer
    }

    clear(): void {
        this.#retired = true
        this.#bytes = new Uint8Array(0)
        this.#size = 0
    }
}
