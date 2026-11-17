import type {Plugin} from "vite"

const VendoredSanitizer = "./dompurify/dompurify.js"
const MonacoBrowserBase = "/monaco-editor/esm/vs/base/browser/"

// Monaco vendors its own DOMPurify copy; route it to the patched package the lockfile pins.
export const monacoDompurify = (): Plugin => ({
    name: "monaco-patched-dompurify",
    enforce: "pre",
    async resolveId(source, importer) {
        if (source !== VendoredSanitizer || importer === undefined
            || !importer.replaceAll("\\", "/").includes(MonacoBrowserBase)) {return null}
        const resolved = await this.resolve("dompurify", importer, {skipSelf: true})
        if (resolved === null) {return this.error("Patched dompurify package is not installed")}
        return resolved
    }
})
