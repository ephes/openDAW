import {
    Arrays,
    assert,
    ByteArrayInput,
    ByteArrayOutput,
    float,
    Float16,
    int,
    Nullable,
    Unhandled
} from "@opendaw/lib-std"

export interface Peaks {
    readonly stages: ReadonlyArray<Peaks.Stage>
    readonly data: ReadonlyArray<Int32Array>
    readonly numFrames: int
    readonly numChannels: int

    nearest(unitsPerPixel: number): Nullable<Peaks.Stage>
}

export namespace Peaks {
    export class Stage {
        constructor(readonly shift: int, readonly numPeaks: int, readonly dataOffset: int) {}

        unitsEachPeak(): int {return 1 << this.shift}
    }

    export const unpack = (bits: int, index: 0 | 1): float => {
        switch (index) {
            case 0:
                return Float16.intBitsToFloat(bits)
            case 1:
                return Float16.intBitsToFloat(bits >> 16)
            default:
                return Unhandled(index)
        }
    }
}

export class SamplePeaks implements Peaks {
    static from(input: ByteArrayInput): Peaks {
        assert(input.readString() === "PEAKS", "Wrong header")
        const numStages = input.readInt()
        assert(numStages >= 0 && numStages <= 31 && input.available(numStages * 16 + 12), "Invalid peak stage count")
        let expectedLength = 0
        let previousShift = -1
        const stages: Array<Peaks.Stage> = []
        for (let i = 0; i < numStages; i++) {
            const dataOffset = input.readInt()
            const numPeaks = input.readInt()
            const shift = input.readInt()
            input.readInt() // deprecated (was mask)
            assert(shift >= 0 && shift <= 30 && shift > previousShift && numPeaks >= 0 && dataOffset === expectedLength, "Invalid peak stage layout")
            previousShift = shift
            expectedLength += numPeaks
            stages[i] = new Peaks.Stage(shift, numPeaks, dataOffset)
        }
        const numData = input.readInt()
        assert(numData >= 0 && input.available(numData * 4 + 8), "Invalid peak channel count")
        const data: Array<Int32Array> = []
        for (let i = 0; i < numData; i++) {
            const length = input.readInt()
            assert(length >= 0 && length % 4 === 0 && length / 4 === expectedLength &&
                input.available(length + (numData - i - 1) * 4 + 8), "Invalid peak data length")
            const array = new Int8Array(length)
            input.readBytes(array)
            data[i] = new Int32Array(array.buffer)
        }
        const numFrames = input.readInt()
        const numChannels = input.readInt()
        assert(numFrames >= 0 && numChannels === numData &&
            (numChannels > 0 || (numFrames === 0 && numStages === 0)), "Invalid peak frame/channel shape")
        for (const stage of stages) {
            assert(stage.numPeaks === Math.ceil(numFrames / (2 ** stage.shift)), "Invalid peak frame/stage shape")
        }
        return new SamplePeaks(stages, data, numFrames, numChannels)
    }

    static readonly None = new SamplePeaks([], [], 0, 0)

    static readonly findBestFit = (numFrames: int, width: int = 1200): Uint8Array => {
        const ratio = numFrames / width
        if (ratio <= 1.0) {
            return new Uint8Array(0)
        }
        const ShiftPadding = 3
        const maxShift = Math.floor(Math.log(ratio) / Math.LN2)
        const numStages = Math.max(1, Math.floor(maxShift / ShiftPadding))
        return new Uint8Array(Arrays.create(index => ShiftPadding * (index + 1), numStages))
    }

    constructor(readonly stages: ReadonlyArray<Peaks.Stage>,
                readonly data: ReadonlyArray<Int32Array>,
                readonly numFrames: int,
                readonly numChannels: int) {}

    nearest(unitsPerPixel: number): Nullable<Peaks.Stage> {
        if (this.stages.length === 0) {return null}
        const shift = Math.floor(Math.log(Math.abs(unitsPerPixel)) / Math.LN2)
        let i = this.stages.length
        while (--i > -1) {
            if (shift >= this.stages[i].shift) {
                return this.stages[i]
            }
        }
        return this.stages[0]
    }

    toArrayBuffer(): ArrayBufferLike {
        const output = ByteArrayOutput.create()
        output.writeString("PEAKS")
        output.writeInt(this.stages.length)
        for (let i = 0; i < this.stages.length; i++) {
            const {dataOffset, numPeaks, shift} = this.stages[i]
            output.writeInt(dataOffset)
            output.writeInt(numPeaks)
            output.writeInt(shift)
            output.writeInt(0) // deprecated (was mask)
        }
        output.writeInt(this.data.length)
        for (let i = 0; i < this.data.length; i++) {
            const view = this.data[i]
            const array = new Int8Array(view.buffer, view.byteOffset, view.byteLength)
            output.writeInt(array.length)
            output.writeBytes(array)
        }
        output.writeInt(this.numFrames)
        output.writeInt(this.numChannels)
        return output.toArrayBuffer()
    }

    toString(): string {return `{SamplePeaks num-stages: ${this.stages.length}}`}
}