import {describe, expect, it, vi} from "vitest"
import {
    ConstantTempoMap,
    EventCollection,
    Interpolation,
    PPQN,
    TempoChangeGrid,
    ValueEvent
} from "@opendaw/lib-dsp"
import {bpm, ppqn, seconds} from "@opendaw/lib-dsp"
import {quantizeCeil, quantizeFloor} from "@opendaw/lib-std"
import {TempoGridCursor} from "./VaryingTempoMap"

describe("intervalToSeconds across ppqn=0", () => {
    const barPpqn = 4 * PPQN.Quarter
    const bpm = 120

    it("returns full span for negative fromPPQN", () => {
        const tempoMap = new ConstantTempoMap({
            getValue: () => bpm,
            subscribe: () => ({terminate: () => {}})
        } as unknown as import("@opendaw/lib-std").ObservableValue<number>)
        const elapsed = tempoMap.intervalToSeconds(-6 * barPpqn, 0)
        expect(elapsed).toBeCloseTo(PPQN.pulsesToSeconds(6 * barPpqn, bpm))
    })

    it("returns full span for interval straddling zero", () => {
        const tempoMap = new ConstantTempoMap({
            getValue: () => bpm,
            subscribe: () => ({terminate: () => {}})
        } as unknown as import("@opendaw/lib-std").ObservableValue<number>)
        const elapsed = tempoMap.intervalToSeconds(-1 * barPpqn, 5 * barPpqn)
        expect(elapsed).toBeCloseTo(PPQN.pulsesToSeconds(6 * barPpqn, bpm))
    })
})

describe("VaryingTempoMap grid helpers", () => {
    const makeEvent = (position: ppqn, index: number, value: number, interpolation: Interpolation): ValueEvent =>
        ({type: "value-event", position, index, value, interpolation})

    const makeCollection = (events: ReadonlyArray<ValueEvent>): EventCollection<ValueEvent> => {
        const collection = EventCollection.create(ValueEvent.Comparator)
        events.forEach(event => collection.add(event))
        return collection
    }

    const naiveIntegrate = (collection: EventCollection<ValueEvent>,
                            fromPPQN: ppqn,
                            toPPQN: ppqn,
                            storageBpm: bpm): seconds => {
        let acc: seconds = 0.0
        let current: ppqn = fromPPQN
        while (current < toPPQN) {
            const currentBpm = ValueEvent.valueAt(collection, quantizeFloor(current, TempoChangeGrid), storageBpm)
            const nextGrid = quantizeCeil(current, TempoChangeGrid)
            const segmentEnd = nextGrid <= current ? nextGrid + TempoChangeGrid : nextGrid
            const actualEnd = Math.min(segmentEnd, toPPQN)
            acc += PPQN.pulsesToSeconds(actualEnd - current, currentBpm)
            current = actualEnd
        }
        return acc
    }

    const naiveAdvance = (collection: EventCollection<ValueEvent>,
                          fromPPQN: ppqn,
                          fromSeconds: seconds,
                          targetSeconds: seconds,
                          storageBpm: bpm): ppqn => {
        let accumulatedSeconds: seconds = fromSeconds
        let accumulatedPPQN: ppqn = fromPPQN
        while (accumulatedSeconds < targetSeconds) {
            const currentBpm = ValueEvent.valueAt(collection, quantizeFloor(accumulatedPPQN, TempoChangeGrid), storageBpm)
            const nextGrid = quantizeCeil(accumulatedPPQN, TempoChangeGrid)
            const segmentEnd = nextGrid <= accumulatedPPQN ? nextGrid + TempoChangeGrid : nextGrid
            const segmentPPQN = segmentEnd - accumulatedPPQN
            const segmentSeconds = PPQN.pulsesToSeconds(segmentPPQN, currentBpm)
            if (accumulatedSeconds + segmentSeconds >= targetSeconds) {
                accumulatedPPQN += PPQN.secondsToPulses(targetSeconds - accumulatedSeconds, currentBpm)
                break
            }
            accumulatedSeconds += segmentSeconds
            accumulatedPPQN = segmentEnd
        }
        return accumulatedPPQN
    }

    const storageBpm: bpm = 120
    const cursor = new TempoGridCursor()

    it("matches naive reference for constant tempo (none, two equal events)", () => {
        const events = [
            makeEvent(0, 0, 140, Interpolation.None),
            makeEvent(PPQN.Bar * 8, 0, 140, Interpolation.None)
        ]
        const collection = makeCollection(events)
        for (let to = 0; to <= PPQN.Bar * 8; to += PPQN.Quarter) {
            expect(cursor.integrate(events,0, to, storageBpm))
                .toBeCloseTo(naiveIntegrate(collection, 0, to, storageBpm), 9)
        }
    })

    it("matches naive reference for a linear segment", () => {
        const events = [
            makeEvent(0, 0, 90, Interpolation.Linear),
            makeEvent(PPQN.Bar * 6, 0, 180, Interpolation.None)
        ]
        const collection = makeCollection(events)
        const pairs: ReadonlyArray<[ppqn, ppqn]> = [
            [0, PPQN.Bar * 6], [PPQN.Quarter, PPQN.Bar * 3], [13, PPQN.Bar * 6 - 27],
            [0, 37], [PPQN.Bar * 2 + 5, PPQN.Bar * 5 + 91]
        ]
        for (const [from, to] of pairs) {
            expect(cursor.integrate(events,from, to, storageBpm))
                .toBeCloseTo(naiveIntegrate(collection, from, to, storageBpm), 9)
        }
    })

    it("matches naive reference for a single curve segment", () => {
        for (const slope of [0.2, 0.8]) {
            const events = [
                makeEvent(0, 0, 100, Interpolation.Curve(slope)),
                makeEvent(PPQN.Bar * 5, 0, 160, Interpolation.None)
            ]
            const collection = makeCollection(events)
            const pairs: ReadonlyArray<[ppqn, ppqn]> = [
                [0, PPQN.Bar * 5], [0, 41], [PPQN.Quarter * 3, PPQN.Bar * 4],
                [17, PPQN.Bar * 5 - 3], [PPQN.Bar + 60, PPQN.Bar * 3 + 7]
            ]
            for (const [from, to] of pairs) {
                expect(cursor.integrate(events,from, to, storageBpm))
                    .toBeCloseTo(naiveIntegrate(collection, from, to, storageBpm), 9)
            }
        }
    })

    const buildLongFixture = (): ReadonlyArray<ValueEvent> => {
        const events: Array<ValueEvent> = []
        let position: ppqn = 0
        for (let i = 0; i < 100; i++) {
            const value: bpm = 60 + ((i * 37) % 140)
            const kind = i % 3
            const interpolation = kind === 0
                ? Interpolation.None
                : kind === 1
                    ? Interpolation.Linear
                    : Interpolation.Curve(0.1 + ((i * 0.13) % 0.8))
            events.push(makeEvent(position, 0, value, interpolation))
            position += PPQN.Quarter + ((i * 113) % (PPQN.Bar * 2))
        }
        return events
    }

    it("matches naive reference for a 100-event mixed fixture", () => {
        const events = buildLongFixture()
        const collection = makeCollection(events)
        const last = events[events.length - 1].position
        const pairs: ReadonlyArray<[ppqn, ppqn]> = [
            [0, last],
            [events[10].position + 3, events[10].position + 50],
            [events[20].position, events[40].position],
            [events[5].position + 17, events[60].position - 41],
            [0, events[0].position - 1],
            [13, events[3].position + 9],
            [events[98].position - 11, last + PPQN.Bar * 3],
            [last - 7, last + PPQN.Quarter],
            [events[33].position + 1, events[33].position + 79],
            [events[50].position + PPQN.Quarter + 5, events[77].position + 200]
        ]
        for (const [from, to] of pairs) {
            expect(cursor.integrate(events,from, to, storageBpm))
                .toBeCloseTo(naiveIntegrate(collection, from, to, storageBpm), 9)
        }
    })

    it("integrate is additive across arbitrary split points", () => {
        const events = buildLongFixture()
        const last = events[events.length - 1].position
        const splits: ReadonlyArray<[ppqn, ppqn, ppqn]> = [
            [0, events[10].position + 13, last],
            [events[5].position + 7, events[30].position, events[70].position - 19],
            [13, 4001, 95271],
            [events[40].position, events[40].position + 40, events[41].position + 5],
            [last - 200, last + 37, last + PPQN.Bar * 2]
        ]
        for (const [a, b, c] of splits) {
            const whole = cursor.integrate(events, a, c, storageBpm)
            const part1 = cursor.integrate(events, a, b, storageBpm)
            const part2 = cursor.integrate(events, b, c, storageBpm)
            expect(part1 + part2).toBeCloseTo(whole, 9)
        }
    })

    it("advanceTempoGrid matches naive reference for the 100-event fixture", () => {
        const events = buildLongFixture()
        const collection = makeCollection(events)
        const last = events[events.length - 1].position
        for (let ppqn = 0; ppqn <= last; ppqn += PPQN.Bar) {
            const targetSeconds = cursor.integrate(events,0, ppqn, storageBpm)
            expect(cursor.advance(events,0, 0, targetSeconds, storageBpm))
                .toBeCloseTo(naiveAdvance(collection, 0, 0, targetSeconds, storageBpm), 6)
        }
    })

    it("round-trips ppqn -> seconds -> ppqn for the 100-event fixture", () => {
        const events = buildLongFixture()
        const last = events[events.length - 1].position
        for (let ppqn = 0; ppqn <= last; ppqn += PPQN.Bar * 3 + 17) {
            const targetSeconds = cursor.integrate(events,0, ppqn, storageBpm)
            expect(cursor.advance(events,0, 0, targetSeconds, storageBpm)).toBeCloseTo(ppqn, 4)
        }
    })
})

it("integrates and advances constant exterior tails with bounded work", () => {
    const cursor = new TempoGridCursor()
    const events: ValueEvent[] = [{type: "value-event", position: 1001, index: 0, value: 120, interpolation: Interpolation.Linear},
        {type: "value-event", position: 2003, index: 1, value: 150, interpolation: Interpolation.None}]
    const conversion = vi.spyOn(PPQN, "pulsesToSeconds")
    try {
        for (const size of [960000, 1920000]) {
            conversion.mockClear()
            expect(cursor.integrate(events, -size, 0, 120)).toBeCloseTo(PPQN.pulsesToSeconds(size, 120), 8)
            expect(cursor.integrate(events, 3000, 3000 + size, 120)).toBeCloseTo(PPQN.pulsesToSeconds(size, 150), 8)
            expect(cursor.advance(events, 3000, 0, PPQN.pulsesToSeconds(size, 150), 120)).toBeCloseTo(3000 + size, 8)
            expect(conversion.mock.calls.length).toBeLessThan(12)
        }
    } finally {conversion.mockRestore()}
})

it("refuses unsupported coordinates and invalid tempo without an unbounded grid walk", () => {
    const cursor = new TempoGridCursor()
    const event = (position: number, value: number): ValueEvent => ({type: "value-event", position, index: 0, value, interpolation: Interpolation.Linear})
    const convert = PPQN.pulsesToSeconds
    let calls = 0
    const conversion = vi.spyOn(PPQN, "pulsesToSeconds").mockImplementation((...args) => {
        if (++calls > 1000) {throw new Error("nonprogressing grid walk")}
        return convert(...args)
    })
    try {
        for (const position of [NaN, Infinity, -Infinity, 2 ** 60]) {
            expect(() => cursor.integrate([event(0, 120), event(2 ** 61, 130)], position, position + 1024, 120)).toThrow(RangeError)
            expect(() => cursor.advance([], position, 0, 1, 120)).toThrow(RangeError)
        }
        for (const value of [0, -1, NaN, Infinity]) {
            expect(() => cursor.integrate([], 0, 80, value)).toThrow(RangeError)
            expect(() => cursor.advance([event(0, value)], 0, 0, 1, 120)).toThrow(RangeError)
        }
        expect(() => cursor.advance([], 0, NaN, 1, 120)).toThrow(RangeError)
        expect(() => cursor.advance([], 0, 0, Infinity, 120)).toThrow(RangeError)
        expect(() => cursor.advance([], 1e15, 0, Number.MIN_VALUE, 120)).toThrow(RangeError)
    } finally {conversion.mockRestore()}
})

it("matches exterior/interior grid sampling across nonaligned event boundaries", () => {
    const events: ValueEvent[] = [
        {type: "value-event", position: 1001, index: 0, value: 90, interpolation: Interpolation.Linear},
        {type: "value-event", position: 2003, index: 1, value: 160, interpolation: Interpolation.None}
    ]
    const collection = EventCollection.create(ValueEvent.Comparator)
    events.forEach(event => collection.add(event))
    const cursor = new TempoGridCursor()
    const reference = (from: number, to: number) => {
        let elapsed = 0
        while (from < to) {
            const sample = quantizeFloor(from, TempoChangeGrid)
            const end = Math.min(to, sample + TempoChangeGrid)
            elapsed += PPQN.pulsesToSeconds(end - from, ValueEvent.valueAt(collection, sample, 120))
            from = end
        }
        return elapsed
    }
    for (const split of [999, 1001, 1010, 2003, 2010]) {
        const elapsed = cursor.integrate(events, -1000, 5000, 120)
        expect(elapsed).toBeCloseTo(reference(-1000, 5000), 10)
        expect(elapsed).toBeCloseTo(cursor.integrate(events, -1000, split, 120) + cursor.integrate(events, split, 5000, 120), 10)
        expect(cursor.advance(events, -1000, 0, elapsed, 120)).toBeCloseTo(5000, 7)
    }
})

it("rejects loss of seconds progress inside a changing tempo zone", () => {
    const events: ValueEvent[] = [
        {type: "value-event", position: 0, index: 0, value: 120, interpolation: Interpolation.Linear},
        {type: "value-event", position: 100000, index: 1, value: 180, interpolation: Interpolation.None}
    ]
    const cursor = new TempoGridCursor()
    const convert = PPQN.pulsesToSeconds
    let calls = 0
    const conversion = vi.spyOn(PPQN, "pulsesToSeconds").mockImplementation((...args) => {
        if (++calls > 1000) {throw new Error("nonprogressing seconds walk")}
        return convert(...args)
    })
    try {expect(() => cursor.advance(events, 0, 2 ** 60, 2 ** 60 + 1024, 120)).toThrow(RangeError)}
    finally {conversion.mockRestore()}
})

it("accepts a same-position tempo step pair and samples the later index", () => {
    const events: ValueEvent[] = [
        {type: "value-event", position: 0, index: 0, value: 100, interpolation: Interpolation.Linear},
        {type: "value-event", position: 1920, index: 0, value: 140, interpolation: Interpolation.None},
        {type: "value-event", position: 1920, index: 1, value: 80, interpolation: Interpolation.Linear},
        {type: "value-event", position: 3840, index: 0, value: 120, interpolation: Interpolation.None}
    ]
    const collection = EventCollection.create(ValueEvent.Comparator)
    events.forEach(event => collection.add(event))
    const sorted = collection.asArray()
    const cursor = new TempoGridCursor()
    let reference = 0
    for (let from = 0; from < 5000; from += TempoChangeGrid) {
        const end = Math.min(5000, from + TempoChangeGrid)
        reference += PPQN.pulsesToSeconds(end - from, ValueEvent.valueAt(collection, from, 120))
    }
    const elapsed = cursor.integrate(sorted, 0, 5000, 120)
    expect(elapsed).toBeCloseTo(reference, 10)
    expect(cursor.advance(sorted, 0, 0, elapsed, 120)).toBeCloseTo(5000, 7)
})
