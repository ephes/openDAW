import type {VideoExportConfig} from "./VideoExporter"

export const MAX_VIDEO_DURATION = 3600
export const MAX_VIDEO_FRAMES = 432_000
export const MAX_VIDEO_PIXELS = 3840 * 2160

/** Shared admission, before allocating canvases, encoders or a file. */
export const validateVideoConfig = (config: VideoExportConfig, duration = 0): void => {
    const {width, height, frameRate, sampleRate, numberOfChannels, videoBitrate = 5_000_000, audioBitrate = 192_000} = config
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096 && value % 2 === 0)
        || width * height > MAX_VIDEO_PIXELS) {
        throw new Error("Video dimensions must be positive even integers, at most 4096 per side and 3840 × 2160 pixels.")
    }
    if (![30, 60, 120].includes(frameRate)) {throw new Error("Video frame rate must be 30, 60 or 120 fps.")}
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000
        || ![1, 2].includes(numberOfChannels)) {throw new Error("Unsupported video audio configuration.")}
    if (!Number.isFinite(videoBitrate) || videoBitrate <= 0 || videoBitrate > 32_000_000
        || !Number.isFinite(audioBitrate) || audioBitrate <= 0 || audioBitrate > 512_000) {
        throw new Error("Unsupported video or audio bitrate.")
    }
    if (!Number.isFinite(duration) || duration < 0 || duration > MAX_VIDEO_DURATION
        || Math.ceil(duration * frameRate) > MAX_VIDEO_FRAMES) {
        throw new Error("Video duration must be 0 (automatic) or at most one hour / 432000 frames.")
    }
}
