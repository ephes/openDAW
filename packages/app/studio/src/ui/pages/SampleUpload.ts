import {WavFile} from "@opendaw/lib-dsp"

export const SampleUploadLimits = Object.freeze({
    sourceBytes: 64 * 1024 * 1024,
    pcmBytes: 64 * 1024 * 1024,
    channels: 32,
    frames: 16 * 1024 * 1024
})
export type SampleUploadEnvelope = {sourceBytes: number, pcmBytes: number, channels: number, frames: number}

export const admitSamplePCM = (frames: number, channels: number, sampleRate: number,
                               limits: SampleUploadEnvelope = SampleUploadLimits): void => {
    if (!Number.isSafeInteger(frames) || frames <= 0 || frames > limits.frames
        || !Number.isSafeInteger(channels) || channels <= 0 || channels > limits.channels
        || !Number.isFinite(sampleRate) || sampleRate <= 0
        || frames > Math.floor(limits.pcmBytes / 4 / channels)) {
        throw new Error("Sample exceeds the decoded PCM upload limits")
    }
}

export const decodeSampleUpload = async (file: File,
                                         context: Pick<AudioContext, "sampleRate" | "decodeAudioData">,
                                         isCurrent: () => boolean = () => true,
                                         limits: SampleUploadEnvelope = SampleUploadLimits): Promise<AudioBuffer> => {
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limits.sourceBytes) {
        throw new Error("Sample exceeds the source byte upload limit")
    }
    const bytes = await file.arrayBuffer()
    if (!isCurrent()) {throw new DOMException("Page retired", "AbortError")}
    if (bytes.byteLength <= 0 || bytes.byteLength > limits.sourceBytes) {
        throw new Error("Sample exceeds the source byte upload limit")
    }
    const {numberOfFrames, numberOfChannels, sampleRate} = WavFile.geometry(bytes)
    admitSamplePCM(numberOfFrames, numberOfChannels, sampleRate, limits)
    // decodeAudioData resamples to the context rate; bound that allocation too.
    admitSamplePCM(Math.ceil(numberOfFrames * context.sampleRate / sampleRate), numberOfChannels, context.sampleRate, limits)
    const buffer = await context.decodeAudioData(bytes)
    if (!isCurrent()) {throw new DOMException("Page retired", "AbortError")}
    admitSamplePCM(buffer.length, buffer.numberOfChannels, buffer.sampleRate, limits)
    return buffer
}
