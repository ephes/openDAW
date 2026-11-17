// @vitest-environment node
import {expect, it} from "vitest"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {build, type Plugin, type Rollup} from "vite"
import {monacoDompurify} from "./MonacoDompurify"

const Floor = [3, 4, 18]
const atLeastFloor = (version: string) => {
    const parts = version.split(".").map(Number)
    for (let index = 0; index < Floor.length; index++) {
        if (parts[index] !== Floor[index]) {return parts[index] > Floor[index]}
    }
    return true
}

it("locks every dompurify copy at or above the patched floor", () => {
    const lock = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../package-lock.json", import.meta.url)), "utf8"))
    const copies = Object.entries(lock.packages as Record<string, {version: string}>)
        .filter(([path]) => path.endsWith("node_modules/dompurify"))
        .map(([path, entry]) => `${path}@${entry.version}`)
    expect(copies.length).toBeGreaterThan(0)
    expect(copies.filter(copy => !atLeastFloor(copy.split("@").pop()!))).toEqual([])
})

it("bundles Monaco's markdown sanitizer with the patched dompurify instead of its vendored copy", async () => {
    const entry: Plugin = {
        name: "synthetic-entry",
        resolveId: source => source === "virtual:monaco-sanitizer" ? source : null,
        load: id => id === "virtual:monaco-sanitizer"
            ? "export {sanitizeHtml} from \"monaco-editor/esm/vs/base/browser/domSanitize.js\"" : null
    }
    const output = await build({
        configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../..", import.meta.url)),
        plugins: [entry, monacoDompurify()],
        build: {write: false, minify: false, rollupOptions: {input: "virtual:monaco-sanitizer"}}
    }) as Rollup.RollupOutput
    const code = output.output.filter(chunk => chunk.type === "chunk").map(chunk => chunk.code).join("\n")
    const versions = [...code.matchAll(/DOMPurify\.version = ["']([\d.]+)["']/g)].map(match => match[1])
    expect(versions.length).toBeGreaterThan(0)
    expect(versions.filter(version => !atLeastFloor(version))).toEqual([])
}, 60_000)
