import {RingBuffer} from "@opendaw/studio-adapters"
self.onmessage = ({data}: MessageEvent<{config: RingBuffer.Config, values: number[]}>) => {
    const writer = RingBuffer.writer(data.config)
    for (const value of data.values) {writer.write([Float32Array.of(value)])}
    self.postMessage("written")
}
