// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"
import {Events} from "./events"
import {Shortcut, ShortcutManager} from "./shortcut-manager"

afterEach(() => vi.restoreAllMocks())

describe("double pointer gesture identity", () => {
    it.each(["subscribeDblDwn", "subscribeDblUp"] as const)("%s requires a nearby matching pair and resets it", method => {
        const target = document.createElement("canvas")
        let now = 50
        vi.spyOn(performance, "now").mockImplementation(() => now)
        const action = vi.fn()
        const single = vi.fn()
        const subscription = Events[method](target, action)
        const type = method === "subscribeDblDwn" ? "pointerdown" : "pointerup"
        target.addEventListener(type, single)
        const send = (button = 0, clientX = 10, pointerType = "mouse") => {
            const event = new MouseEvent(type, {button, clientX, clientY: 10, cancelable: true})
            Object.defineProperty(event, "pointerType", {value: pointerType})
            target.dispatchEvent(event)
            now += 40
            return event
        }
        expect(send().defaultPrevented).toBe(false) // first event at 50ms
        send(2)
        send(0)
        send(0, 500)
        send(0, 500, "pen")
        expect(action).not.toHaveBeenCalled()
        expect(send(0, 502, "pen").defaultPrevented).toBe(true)
        send(0, 502, "pen") // third event starts a new pair
        expect(action).toHaveBeenCalledTimes(1)
        expect(single).toHaveBeenCalledTimes(6)
        now += 250
        send(0, 502, "pen")
        expect(action).toHaveBeenCalledTimes(1)
        subscription.terminate()
    })
})

describe("shortcut dispatch", () => {
    const key = Shortcut.of("KeyJ")
    const event = () => new KeyboardEvent("keydown", {key: "j", code: "KeyJ", cancelable: true})
    const manager = ShortcutManager.get()
    it("continues locally after a decline and prevents default only on consumption", () => {
        const context = manager.createContext(() => true, "local", 20)
        const lower = manager.createContext(() => true, "lower", 10)
        try {
            const calls: string[] = []
            context.register(key, () => {calls.push("decline"); return false}, {priority: 0})
            const consumer = context.register(key, () => {calls.push("consume")}, {priority: 1})
            lower.register(key, () => {calls.push("lower"); return false})
            const first = event()
            manager.handleEvent(first)
            expect(calls).toEqual(["decline", "consume"])
            expect(first.defaultPrevented).toBe(true)
            consumer.terminate()
            calls.length = 0
            const second = event()
            manager.handleEvent(second)
            expect(calls).toEqual(["decline", "lower"])
            expect(second.defaultPrevented).toBe(false)
            lower.register(key, () => true, {preventDefault: false})
            const third = event()
            manager.handleEvent(third)
            expect(third.defaultPrevented).toBe(false)
        } finally {context.terminate(); lower.terminate()}
    })
    it("snapshots all contexts and entries before invoking callbacks", () => {
        const high = manager.createContext(() => true, "high", 20)
        const low = manager.createContext(() => true, "low", 10)
        const retired = manager.createContext(() => true, "retired", 15)
        const calls: string[] = []
        try {
            retired.register(key, () => {calls.push("retired")})
            high.register(key, () => {
                calls.push("high")
                high.terminate()
                retired.terminate()
                low.register(key, () => {calls.push("new"); return true}, {priority: -1})
                return false
            })
            low.register(key, () => {calls.push("low"); return false})
            manager.handleEvent(event())
            expect(calls).toEqual(["high", "low"])
            manager.handleEvent(event())
            expect(calls).toEqual(["high", "low", "new"])
        } finally {high.terminate(); low.terminate(); retired.terminate()}
    })
    it("ignores entries removed before their turn and idempotent unsubscribe preserves siblings", () => {
        const context = manager.createContext(() => true, "entries", 20)
        try {
            const consume = vi.fn()
            const later = context.register(key, consume, {priority: 1})
            context.register(key, () => {later.terminate(); later.terminate(); return false}, {priority: 0})
            manager.handleEvent(event())
            manager.handleEvent(event())
            expect(consume).not.toHaveBeenCalled()
            expect(context.entries).toHaveLength(1)
        } finally {context.terminate()}
    })
})
