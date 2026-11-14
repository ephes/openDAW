export namespace Compression {
    const transfer = async (buffer: ArrayBuffer,
                            stream: {readable: ReadableStream<Uint8Array>, writable: WritableStream<BufferSource>}): Promise<ArrayBuffer> => {
        const writer = stream.writable.getWriter()
        const reader = stream.readable.getReader()
        const produce = async () => {
            await writer.write(new Uint8Array(buffer))
            await writer.close()
        }
        const consume = async () => {
            const chunks: Uint8Array[] = []
            let size = 0
            for (;;) {
                const {done, value} = await reader.read()
                if (done) {break}
                chunks.push(value)
                size += value.byteLength
            }
            const result = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) {
                result.set(chunk, offset)
                offset += chunk.byteLength
            }
            return result.buffer
        }
        // Start both ends before awaiting: writing first can deadlock on backpressure.
        const producer = produce()
        const consumer = consume()
        try {
            const [, result] = await Promise.all([producer, consumer])
            return result
        } catch (reason) {
            await Promise.allSettled([writer.abort(reason), reader.cancel(reason)])
            await Promise.allSettled([producer, consumer])
            throw reason
        } finally {
            writer.releaseLock()
            reader.releaseLock()
        }
    }

    export const encode = async (buffer: ArrayBuffer, format: CompressionFormat = "gzip"): Promise<ArrayBuffer> =>
        transfer(buffer, new CompressionStream(format))

    export const decode = async (buffer: ArrayBuffer, format: CompressionFormat = "gzip"): Promise<ArrayBuffer> =>
        transfer(buffer, new DecompressionStream(format))
}
