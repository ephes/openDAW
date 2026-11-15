export const centeredEnergyEnvelope = (buffer: Float32Array, windowSamples: number): Float32Array => {
    const halfWindow = Math.floor(windowSamples / 2)
    const envelope = new Float32Array(buffer.length)
    let sumSq = 0.0
    for (let index = 0; index < halfWindow && index < buffer.length; index++) {
        sumSq += buffer[index] * buffer[index]
    }
    for (let index = 0; index < buffer.length; index++) {
        const windowStart = index - halfWindow
        const windowEnd = index + halfWindow
        if (windowStart > 0 && windowStart - 1 < buffer.length) {
            const old = buffer[windowStart - 1]
            sumSq -= old * old
        }
        if (windowEnd < buffer.length) {
            const next = buffer[windowEnd]
            sumSq += next * next
        }
        const count = Math.min(windowEnd, buffer.length - 1) - Math.max(windowStart, 0) + 1
        envelope[index] = Math.sqrt(Math.max(0.0, sumSq) / count)
    }
    return envelope
}

export const transientValley = (mono: Float32Array, current: number, searchStart: number, rmsWindow: number): number => {
    let sum = 0
    for (let offset = 0; offset < rmsWindow && current + offset < mono.length; offset++) {
        const value = mono[current + offset]
        sum += value * value
    }
    const threshold = Math.sqrt(sum / rmsWindow) * 0.66
    let minimum = Infinity
    let position = current
    for (let index = current - 1; index >= searchStart; index--) {
        const added = mono[index]
        sum += added * added
        if (index + rmsWindow < mono.length) {
            const removed = mono[index + rmsWindow]
            sum -= removed * removed
        }
        const rms = Math.sqrt(Math.max(0, sum) / rmsWindow)
        if (rms < minimum) {minimum = rms; position = index}
        if (rms < threshold) {break}
    }
    return position
}
