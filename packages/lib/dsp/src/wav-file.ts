import {Arrays, int, panic} from "@opendaw/lib-std"
import {AudioData} from "./audio-data"

export namespace WavFile {
    const MAGIC_RIFF = 0x46464952
    const MAGIC_WAVE = 0x45564157
    const MAGIC_FMT = 0x20746d66
    const MAGIC_DATA = 0x61746164

    export const decodeFloats = (buffer: ArrayBuffer): AudioData => {
        const view = new DataView(buffer)
        if (view.byteLength < 12) {return panic("Invalid WAV header")}
        if (view.getUint32(0, true) !== MAGIC_RIFF
            || view.getUint32(8, true) !== MAGIC_WAVE) {
            return panic("Not a RIFF/WAVE file")
        }
        const riffEnd = 8 + view.getUint32(4, true)
        if (riffEnd < 12 || riffEnd > view.byteLength) {return panic("Invalid WAV RIFF bounds")}
        let fmtOffset = -1
        let dataOffset = -1
        let dataSize = 0
        for (let o = 12; o < riffEnd;) {
            if (o + 8 > riffEnd) {return panic("Invalid WAV chunk header")}
            const id = view.getUint32(o, true)
            const size = view.getUint32(o + 4, true)
            const next = o + 8 + size + size % 2
            if (next > riffEnd) {return panic("Invalid WAV chunk bounds")}
            if (id === MAGIC_FMT) {
                if (size < 16) {return panic("Invalid WAV fmt chunk")}
                fmtOffset = o + 8
            }
            if (id === MAGIC_DATA) {
                dataOffset = o + 8
                dataSize = size
            }
            o = next
        }
        if (fmtOffset < 0 || dataOffset < 0) {
            return panic("Missing fmt or data chunk")
        }
        const audioFormat = view.getUint16(fmtOffset, true)  // 1 = PCM, 3 = IEEE float
        const numberOfChannels = view.getUint16(fmtOffset + 2, true)
        const sampleRate = view.getUint32(fmtOffset + 4, true)
        const blockAlign = view.getUint16(fmtOffset + 12, true)
        const bitsPerSample = view.getUint16(fmtOffset + 14, true)
        const bytesPerSample = bitsPerSample / 8
        if (numberOfChannels === 0 || sampleRate === 0 || blockAlign === 0
            || blockAlign !== numberOfChannels * bytesPerSample || dataSize % blockAlign !== 0) {
            return panic("Invalid WAV frame dimensions")
        }
        if (!((audioFormat === 3 && bitsPerSample === 32)
            || (audioFormat === 1 && (bitsPerSample === 16 || bitsPerSample === 24)))) {
            return panic(`Unsupported WAV format: ${audioFormat}, ${bitsPerSample}-bit`)
        }
        const numberOfFrames = dataSize / blockAlign
        const audioData = AudioData.create(sampleRate, numberOfFrames, numberOfChannels)
        if (audioFormat === 3 && bitsPerSample === 32) {
            for (let i = 0, offset = dataOffset; i < numberOfFrames; i++) {
                for (let c = 0; c < numberOfChannels; c++) {
                    audioData.frames[c][i] = view.getFloat32(offset, true)
                    offset += 4
                }
            }
        } else if (audioFormat === 1 && bitsPerSample === 16) {
            for (let i = 0, offset = dataOffset; i < numberOfFrames; i++) {
                for (let c = 0; c < numberOfChannels; c++) {
                    audioData.frames[c][i] = view.getInt16(offset, true) / 32768
                    offset += 2
                }
            }
        } else if (audioFormat === 1 && bitsPerSample === 24) {
            for (let i = 0, offset = dataOffset; i < numberOfFrames; i++) {
                for (let c = 0; c < numberOfChannels; c++) {
                    const low = view.getUint16(offset, true)
                    const high = view.getInt8(offset + 2)
                    audioData.frames[c][i] = (high * 65536 + low) / 8388608
                    offset += 3
                }
            }
        } else {
            return panic(`Unsupported WAV format: ${audioFormat}, ${bitsPerSample}-bit`)
        }
        return audioData
    }

    type AudioBufferLike = {
        readonly sampleRate: number
        readonly length: number
        readonly numberOfChannels: number
        getChannelData(channel: number): Float32Array
    }

    const encodingSize = (frames: number, channels: number, sampleRate: number, maxLength: number,
                          bytesPerSample: number): {numberOfFrames: number, size: number} => {
        if (!Number.isSafeInteger(frames) || frames < 0 || !Number.isSafeInteger(maxLength) || maxLength < 0
            || !Number.isInteger(channels) || channels <= 0 || channels * bytesPerSample > 0xffff
            || !Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff
            || sampleRate * channels * bytesPerSample > 0xffffffff) {
            return panic("Invalid WAV export dimensions or frame limit")
        }
        const numberOfFrames = Math.min(frames, maxLength)
        const dataSize = numberOfFrames * channels * bytesPerSample
        if (!Number.isSafeInteger(dataSize) || 36 + dataSize > 0xffffffff) {
            return panic("WAV export too large for classic RIFF")
        }
        return {numberOfFrames, size: 44 + dataSize}
    }

    /**
     * Encode the audio as a 16-bit PCM WAV file. Float samples are clamped
     * to [-1, 1] and scaled to int16. Same input shape as `encodeFloats`
     * (`AudioData` or `AudioBufferLike`); output is a complete RIFF/WAVE
     * ArrayBuffer ready to drop into a Blob or pass to importers expecting
     * standard 16-bit WAV.
     */
    export const encodeInts16 = (audio: AudioData | AudioBufferLike, maxLength: int = Number.MAX_SAFE_INTEGER): ArrayBuffer => {
        const bytesPerSample = 2
        const sampleRate = audio.sampleRate
        const numberOfChannels = "getChannelData" in audio ? audio.numberOfChannels : audio.frames.length
        const {numberOfFrames, size} = encodingSize(
            "getChannelData" in audio ? audio.length : audio.numberOfFrames,
            numberOfChannels, sampleRate, maxLength, bytesPerSample)
        const frames = "getChannelData" in audio
            ? Arrays.create(index => audio.getChannelData(index), numberOfChannels) : audio.frames
        const dataSize = numberOfFrames * numberOfChannels * bytesPerSample
        const buf = new ArrayBuffer(size)
        const view = new DataView(buf)
        view.setUint32(0, MAGIC_RIFF, true)
        view.setUint32(4, size - 8, true)
        view.setUint32(8, MAGIC_WAVE, true)
        view.setUint32(12, MAGIC_FMT, true)
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true) // 1 = PCM
        view.setUint16(22, numberOfChannels, true)
        view.setUint32(24, sampleRate, true)
        view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true)
        view.setUint16(32, numberOfChannels * bytesPerSample, true)
        view.setUint16(34, 8 * bytesPerSample, true)
        view.setUint32(36, MAGIC_DATA, true)
        view.setUint32(40, dataSize, true)
        let w = 44
        for (let i = 0; i < numberOfFrames; ++i) {
            for (let j = 0; j < numberOfChannels; ++j) {
                const sample = frames[j][i]
                const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
                view.setInt16(w, Math.round(clamped * 0x7fff), true)
                w += bytesPerSample
            }
        }
        return view.buffer
    }

    export const encodeFloats = (audio: AudioData | AudioBufferLike, maxLength: int = Number.MAX_SAFE_INTEGER): ArrayBuffer => {
        const bytesPerChannel = Float32Array.BYTES_PER_ELEMENT
        const sampleRate = audio.sampleRate
        const numberOfChannels = "getChannelData" in audio ? audio.numberOfChannels : audio.frames.length
        const {numberOfFrames, size} = encodingSize(
            "getChannelData" in audio ? audio.length : audio.numberOfFrames,
            numberOfChannels, sampleRate, maxLength, bytesPerChannel)
        const frames = "getChannelData" in audio
            ? Arrays.create(index => audio.getChannelData(index), numberOfChannels) : audio.frames
        const buf = new ArrayBuffer(size)
        const view = new DataView(buf)
        view.setUint32(0, MAGIC_RIFF, true)
        view.setUint32(4, size - 8, true)
        view.setUint32(8, MAGIC_WAVE, true)
        view.setUint32(12, MAGIC_FMT, true)
        view.setUint32(16, 16, true)
        view.setUint16(20, 3, true)
        view.setUint16(22, numberOfChannels, true)
        view.setUint32(24, sampleRate, true)
        view.setUint32(28, sampleRate * numberOfChannels * bytesPerChannel, true)
        view.setUint16(32, numberOfChannels * bytesPerChannel, true)
        view.setUint16(34, 8 * bytesPerChannel, true)
        view.setUint32(36, MAGIC_DATA, true)
        view.setUint32(40, numberOfChannels * numberOfFrames * bytesPerChannel, true)
        let w = 44
        for (let i = 0; i < numberOfFrames; ++i) {
            for (let j = 0; j < numberOfChannels; ++j) {
                view.setFloat32(w, frames[j][i], true)
                w += bytesPerChannel
            }
        }
        return view.buffer
    }
}
