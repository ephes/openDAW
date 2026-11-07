// noinspection JSUnusedGlobalSymbols

declare class TypedArray<T extends number | bigint = number> {
    readonly buffer: ArrayBuffer
    readonly byteOffset: number
    readonly byteLength: number
    readonly length: number
    [index: number]: T
    copyWithin(target: number, start: number, end?: number): this
    every(callbackfn: (value: T, index: number, array: this) => boolean): boolean
    fill(value: T, start?: number, end?: number): this
    filter(callbackfn: (value: T, index: number, array: this) => boolean): this
    find(callbackfn: (value: T, index: number, array: this) => boolean): T | undefined
    findIndex(callbackfn: (value: T, index: number, array: this) => boolean): number
    forEach(callbackfn: (value: T, index: number, array: this) => void): void
    includes(value: T, fromIndex?: number): boolean
    indexOf(value: T, fromIndex?: number): number
    join(separator?: string): string
    lastIndexOf(value: T, fromIndex?: number): number
    map(callbackfn: (value: T, index: number, array: this) => T): this
    reduce(callbackfn: (prev: T, curr: T, index: number, array: this) => T): T
    reduceRight(callbackfn: (prev: T, curr: T, index: number, array: this) => T): T
    reduce<U>(callbackfn: (prev: U, curr: T, index: number, array: this) => U, initialValue: U): U
    reduceRight<U>(callbackfn: (prev: U, curr: T, index: number, array: this) => U, initialValue: U): U
    reverse(): this
    set(array: ArrayLike<T>, offset?: number): void
    slice(start?: number, end?: number): this
    some(callbackfn: (value: T, index: number, array: this) => boolean): boolean
    sort(compareFn?: (a: T, b: T) => number): this
    subarray(begin?: number, end?: number): this
    toLocaleString(): string
    toString(): string
    values(): IterableIterator<T>
    keys(): IterableIterator<number>
    entries(): IterableIterator<[number, T]>
    [Symbol.iterator](): IterableIterator<T>
}

declare class Int8Array extends TypedArray {
    [index: number]: number
    constructor(length: number)
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Uint8Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Uint8ClampedArray extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Int16Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Uint16Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Int32Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Uint32Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Float32Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class Float64Array extends TypedArray {
    [index: number]: number;
    constructor(length: number);
    constructor(array: ArrayLike<number> | ArrayBuffer)
}

declare class BigInt64Array extends TypedArray<bigint> {
    [index: number]: bigint;
    constructor(length: number);
    constructor(array: ArrayLike<bigint> | ArrayBuffer)
}

declare class BigUint64Array extends TypedArray<bigint> {
    [index: number]: bigint;
    constructor(length: number);
    constructor(array: ArrayLike<bigint> | ArrayBuffer)
}

declare class Array<T> {
    readonly length: number
    [index: number]: T

    constructor()
    constructor(length: number)
    constructor(...items: T[])

    at(index: number): T | undefined
    concat(...items: (T | ConcatArray<T>)[]): T[]
    copyWithin(target: number, start: number, end?: number): this
    entries(): IterableIterator<[number, T]>
    every(callbackfn: (value: T, index: number, array: T[]) => boolean): boolean
    fill(value: T, start?: number, end?: number): this
    filter(callbackfn: (value: T, index: number, array: T[]) => boolean): T[]
    find(callbackfn: (value: T, index: number, array: T[]) => boolean): T | undefined
    findIndex(callbackfn: (value: T, index: number, array: T[]) => boolean): number
    flat<U>(this: U[][], depth?: number): U[]
    flatMap<U>(callbackfn: (value: T, index: number, array: T[]) => U | readonly U[]): U[]
    forEach(callbackfn: (value: T, index: number, array: T[]) => void): void
    includes(value: T, fromIndex?: number): boolean
    indexOf(value: T, fromIndex?: number): number
    join(separator?: string): string
    keys(): IterableIterator<number>
    lastIndexOf(value: T, fromIndex?: number): number
    map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[]
    pop(): T | undefined
    push(...items: T[]): number
    reduce(callbackfn: (prev: T, curr: T, index: number, array: T[]) => T): T
    reduceRight(callbackfn: (prev: T, curr: T, index: number, array: T[]) => T): T
    reverse(): this
    shift(): T | undefined
    slice(start?: number, end?: number): T[]
    some(callbackfn: (value: T, index: number, array: T[]) => boolean): boolean
    sort(compareFn?: (a: T, b: T) => number): this
    splice(start: number, deleteCount?: number, ...items: T[]): T[]
    toLocaleString(): string
    toString(): string
    unshift(...items: T[]): number
    values(): IterableIterator<T>
    [Symbol.iterator](): IterableIterator<T>
    [Symbol.unscopables](): Record<string, boolean>
}

interface ConcatArray<T> {
    readonly length: number
    [n: number]: T
    concat(...items: ConcatArray<T>[]): T[]
}

interface PromiseConstructor {
    readonly prototype: Promise<unknown>;
    new<T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>;
    all<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]>; }>;
    race<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>;
    reject<T = never>(reason?: unknown): Promise<T>;
    resolve(): Promise<void>;
    resolve<T>(value: T): Promise<Awaited<T>>;
    resolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>;
}

declare let Promise: PromiseConstructor

declare function setInterval(handler: TimerHandler, timeout?: number, ...arguments: unknown[]): number;
declare function setTimeout(handler: TimerHandler, timeout?: number, ...arguments: unknown[]): number;

interface IteratorYieldResult<TYield> {
    done?: false
    value: TYield
}

interface IteratorReturnResult<TReturn> {
    done: true
    value: TReturn
}

type IteratorResult<T, TReturn = unknown> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>

interface Iterator<T, TReturn = unknown, TNext = undefined> {
    next(...args: [] | [TNext]): IteratorResult<T, TReturn>
    return?(value?: TReturn): IteratorResult<T, TReturn>
    throw?(e?: unknown): IteratorResult<T, TReturn>
}

interface Iterable<T> {
    [Symbol.iterator](): Iterator<T>
}

interface IterableIterator<T> extends Iterator<T> {
    [Symbol.iterator](): IterableIterator<T>
}

interface SymbolConstructor {
    readonly iterator: symbol
    readonly unscopables: symbol
}

declare let Symbol: SymbolConstructor

type Partial<T> = { [P in keyof T]?: T[P] }
type Required<T> = { [P in keyof T]-?: T[P] }
type Readonly<T> = { readonly [P in keyof T]: T[P] }
type Pick<T, K extends keyof T> = { [P in K]: T[P] }
type Omit<T, K extends string | number | symbol> = Pick<T, Exclude<keyof T, K>>
type Record<K extends string | number | symbol, T> = { [P in K]: T }
type Exclude<T, U> = T extends U ? never : T
type Extract<T, U> = T extends U ? T : never
type NonNullable<T> = T extends null | undefined ? never : T
type ReturnType<T extends (...args: never[]) => unknown> = T extends (...args: never[]) => infer R ? R : unknown
type Parameters<T extends (...args: never[]) => unknown> = T extends (...args: infer P) => unknown ? P : never
type Awaited<T> = T extends null | undefined ? T : T extends object & {
    then(onfulfilled: infer F, ...args: infer _): unknown
} ? F extends ((value: infer V, ...args: infer _) => unknown) ? Awaited<V> : never : T

interface ReadonlyArray<T> {
    readonly length: number
    readonly [n: number]: T
    concat(...items: (T | ConcatArray<T>)[]): T[]
    every(callbackfn: (value: T, index: number, array: readonly T[]) => boolean): boolean
    filter(callbackfn: (value: T, index: number, array: readonly T[]) => boolean): T[]
    find(callbackfn: (value: T, index: number, array: readonly T[]) => boolean): T | undefined
    findIndex(callbackfn: (value: T, index: number, array: readonly T[]) => boolean): number
    forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void): void
    includes(value: T, fromIndex?: number): boolean
    indexOf(value: T, fromIndex?: number): number
    join(separator?: string): string
    lastIndexOf(value: T, fromIndex?: number): number
    map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U): U[]
    reduce(callbackfn: (prev: T, curr: T, index: number, array: readonly T[]) => T): T
    reduceRight(callbackfn: (prev: T, curr: T, index: number, array: readonly T[]) => T): T
    slice(start?: number, end?: number): T[]
    some(callbackfn: (value: T, index: number, array: readonly T[]) => boolean): boolean
    [Symbol.iterator](): IterableIterator<T>
}