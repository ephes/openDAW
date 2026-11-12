import {isDefined, Optional} from "@opendaw/lib-std"
import {dbToGain} from "@opendaw/lib-dsp"

export namespace AudioUtils {
    export const outputLatencySeconds = (latency: Optional<number>): number =>
        isDefined(latency) && Number.isFinite(latency) && latency >= 0.0 ? latency : 0.0

    export const findLastNonSilentSample = (buffer: AudioBuffer, thresholdDb: number = -72.0): number => {
        const threshold = dbToGain(thresholdDb)
        const numChannels = buffer.numberOfChannels
        const length = buffer.length
        let lastNonSilentSample = 0
        for (let channel = 0; channel < numChannels; channel++) {
            const channelData = buffer.getChannelData(channel)
            for (let i = length - 1; i >= 0; i--) {
                if (Math.abs(channelData[i]) > threshold) {
                    lastNonSilentSample = Math.max(lastNonSilentSample, i)
                    break
                }
            }
        }
        return lastNonSilentSample + 1
    }
}