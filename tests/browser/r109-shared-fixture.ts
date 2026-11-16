import {RingBuffer} from "@opendaw/studio-adapters"

export const recordingRing = async () => {
    const worker = new Worker(new URL("./r109-ring-worker.ts", import.meta.url), {type: "module"})
    const makeConfig = (): RingBuffer.Config => ({sab: new SharedArrayBuffer(RingBuffer.HEADER_BYTES + 8), numChunks: 2, numberOfChannels: 1, bufferSize: 1})
    const write = (config: RingBuffer.Config, values: number[]) => new Promise<void>(resolve => {
        worker.onmessage = () => resolve()
        worker.postMessage({config, values})
    })
    try {
        const full = makeConfig()
        await write(full, [1, 2])
        let lost = 0, delivered = 0
        RingBuffer.reader(full, () => {delivered++}, frames => {lost = frames}).stop()
        const healthy = makeConfig(), seen: number[] = []
        const reader = RingBuffer.reader(healthy, channels => seen.push(channels[0][0]))
        try {
            for (let i = 1; i <= 8; i++) {
                await write(healthy, [i])
                while (seen.length < i) {await new Promise(resolve => setTimeout(resolve, 1))}
            }
        } finally {reader.stop()}
        return {lost, delivered, seen}
    } finally {worker.terminate()}
}
