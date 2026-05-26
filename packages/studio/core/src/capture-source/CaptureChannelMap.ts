import {assert, Arrays, int} from "@opendaw/lib-std"

export type CaptureChannelMap = ReadonlyArray<int>

export namespace CaptureChannelMap {
    export const identity = (numberOfChannels: int): CaptureChannelMap =>
        Arrays.create(channelIndex => channelIndex, numberOfChannels)

    export const swap = (left: int, right: int): CaptureChannelMap => [right, left]

    export const monoFromChannel = (channelIndex: int): CaptureChannelMap => [channelIndex]

    export const validate = (map: CaptureChannelMap, sourceChannelCount: int): true => {
        assert(map.length > 0, "channel map must produce at least one output channel")
        for (let outputIndex = 0; outputIndex < map.length; outputIndex++) {
            const sourceIndex = map[outputIndex]
            assert(Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < sourceChannelCount,
                `channel map entry ${outputIndex} -> ${sourceIndex} is out of range [0, ${sourceChannelCount})`)
        }
        return true
    }

    export const isIdentity = (map: CaptureChannelMap): boolean => {
        for (let index = 0; index < map.length; index++) {
            if (map[index] !== index) {return false}
        }
        return true
    }

    export const apply = (
        sourceChannels: ReadonlyArray<Float32Array>,
        map: CaptureChannelMap
    ): ReadonlyArray<Float32Array> => {
        validate(map, sourceChannels.length)
        const frames = sourceChannels[0]?.length ?? 0
        for (let index = 1; index < sourceChannels.length; index++) {
            assert(sourceChannels[index].length === frames, "all source channels must have the same length")
        }
        const result: Array<Float32Array> = []
        for (let outputIndex = 0; outputIndex < map.length; outputIndex++) {
            const sourceIndex = map[outputIndex]
            result.push(sourceChannels[sourceIndex])
        }
        return result
    }

    export const applyInPlace = (
        sourceChannels: ReadonlyArray<Float32Array>,
        map: CaptureChannelMap,
        outputChannels: ReadonlyArray<Float32Array>
    ): void => {
        validate(map, sourceChannels.length)
        assert(outputChannels.length === map.length, "outputChannels length must equal map length")
        for (let outputIndex = 0; outputIndex < map.length; outputIndex++) {
            const sourceIndex = map[outputIndex]
            const source = sourceChannels[sourceIndex]
            const destination = outputChannels[outputIndex]
            assert(destination.length === source.length,
                "output channel buffer must match source channel length")
            destination.set(source)
        }
    }
}
