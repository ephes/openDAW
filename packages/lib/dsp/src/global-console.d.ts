// This global definition ensures TypeScript recognizes the `console` object,
// even when compiling without DOM lib definitions.
// This definition avoids the need to include unwanted DOM types,
// while still allowing use of `console.log`, `console.warn`, etc. in the codebase.
declare let console: {
    log: (...args: unknown[]) => void
    debug: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    [key: string]: (...args: unknown[]) => void
}