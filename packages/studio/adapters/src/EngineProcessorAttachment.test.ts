import {expect, it} from "vitest"
import {ExportConfiguration, ExportStemConfiguration} from "./EngineProcessorAttachment"
it("exports distinct portable basenames under case and Unicode normalization", () => {
    const names = ["Track", "track", "é", "e\u0301", "", "...", "***", "CON", "con.wav", "LPT1", "hello. ", "track 1", "TRACK", "a".repeat(300), ".".repeat(250) + "a", "*".repeat(250) + "b", ".".repeat(198) + "c", ".".repeat(198) + "C"]
    const stems = Object.fromEntries(names.map((fileName, i) => [String(i), {fileName} as ExportStemConfiguration]))
    const config = {stems}; ExportConfiguration.sanitizeExportNamesInPlace(config)
    const results = Object.values(stems).map(stem => stem.fileName)
    const keys = results.map(name => name.normalize("NFKC").toLowerCase().replace(/[. ]+$/u, ""))
    expect(new Set(keys).size).toBe(names.length)
    for (const name of results) {
        expect(name).not.toMatch(/[<>:"/\\|?*]/u)
        expect(Array.from(name).every(character => character.charCodeAt(0) > 31)).toBe(true)
        expect(name).not.toMatch(/[. ]$/u)
        expect(name).not.toMatch(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu)
        expect(name).toMatch(/[\p{L}\p{N}]/u)
        expect(name).not.toMatch(/^[\s_.]*\d*$/u)
        expect(new TextEncoder().encode(name + ".wav").length).toBeLessThanOrEqual(240)
    }
    const first = results.slice(); ExportConfiguration.sanitizeExportNamesInPlace(config)
    expect(Object.values(stems).map(stem => stem.fileName)).toEqual(first)
})
