import {int} from "@opendaw/lib-std"

export namespace SampleRateConverter {
    export const convert = (
        source: Float32Array,
        sourceSampleRate: number,
        targetSampleRate: number
    ): Float32Array => {
        const targetLength = calculateOutputLength(source.length, sourceSampleRate, targetSampleRate)
        if (source.length === 0) {
            return new Float32Array(0)
        }

        if (sourceSampleRate === targetSampleRate) {
            return source.slice()
        }

        const ratio = sourceSampleRate / targetSampleRate
        const target = new Float32Array(targetLength)

        for (let i: int = 0; i < targetLength; i++) {
            const srcPos = i * ratio
            const srcIndex = Math.floor(srcPos)
            const frac = srcPos - srcIndex

            const s0 = source[srcIndex]
            const s1 = source[Math.min(srcIndex + 1, source.length - 1)]
            target[i] = s0 + frac * (s1 - s0)
        }

        return target
    }

    export const calculateOutputLength = (
        sourceLength: int,
        sourceSampleRate: number,
        targetSampleRate: number
    ): int => {
        const maxLength = Math.floor(0xFFFFFFFF / Float32Array.BYTES_PER_ELEMENT)
        if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0
            || !Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
            throw new RangeError("Sample rates must be finite and positive")
        }
        if (!Number.isSafeInteger(sourceLength) || sourceLength < 0 || sourceLength > maxLength) {
            throw new RangeError("Source length exceeds float32 geometry")
        }
        if (sourceLength === 0) {
            return 0
        }
        const ratio = sourceSampleRate / targetSampleRate
        const length = Math.max(1, Math.floor(sourceLength / ratio))
        if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isSafeInteger(length) || length > maxLength) {
            throw new RangeError("Output length exceeds float32 geometry")
        }
        return length
    }
}
