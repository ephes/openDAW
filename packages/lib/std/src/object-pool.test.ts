import {describe, expect, it} from "vitest"
import {ObjectPool} from "./object-pool"

describe("ObjectPool ownership", () => {
    const create = () => {let next = 0; return new ObjectPool(() => ({id: next++}), 2)}
    it("keeps live objects distinct across growth and reuses only released objects", () => {
        const pool = create()
        const live = Array.from({length: 37}, () => pool.acquire())
        expect(new Set(live).size).toBe(live.length)
        expect(pool.inUseCount).toBe(live.length)
        expect(pool.availableCount + pool.inUseCount).toBe(pool.totalSize)
        const released = live.splice(5, 1)[0]
        pool.release(released)
        const acquired = Array.from({length: pool.availableCount}, () => pool.acquire())
        expect(acquired).toContain(released)
        expect(acquired.every(value => !live.includes(value))).toBe(true)
        expect(new Set([...live, ...acquired]).size).toBe(pool.inUseCount)
    })
    it("rejects foreign/double releases without changing counters", () => {
        const pool = create()
        const object = pool.acquire()
        const before = [pool.inUseCount, pool.availableCount, pool.totalSize]
        expect(() => pool.release({id: 99})).toThrow()
        expect([pool.inUseCount, pool.availableCount, pool.totalSize]).toEqual(before)
        pool.release(object)
        const released = [pool.inUseCount, pool.availableCount, pool.totalSize]
        expect(() => pool.release(object)).toThrow()
        expect([pool.inUseCount, pool.availableCount, pool.totalSize]).toEqual(released)
    })
    it("releaseAll returns each live identity once and is idempotent when empty", () => {
        const pool = create()
        const live = Array.from({length: 23}, () => pool.acquire())
        pool.release(live.pop()!)
        const total = pool.totalSize
        pool.releaseAll()
        pool.releaseAll()
        expect(pool.inUseCount).toBe(0)
        expect(pool.availableCount).toBe(total)
        const acquired = Array.from({length: total}, () => pool.acquire())
        expect(new Set(acquired).size).toBe(total)
        expect(live.every(value => acquired.includes(value))).toBe(true)
        expect(pool.availableCount).toBe(0)
    })
})
