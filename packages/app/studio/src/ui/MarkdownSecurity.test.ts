import {expect, it, vi} from "vitest"
import {URL as NodeURL} from "node:url"
import {readFileSync} from "node:fs"
import {renderMarkdown} from "./Markdown"
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "markdown"}}
})
vi.mock("@/ui/components/Icon", () => ({Icon: () => null}))
const patched = (version: string) => {
    const [major, minor, patch] = version.replace(/^\^/, "").split(".").map(Number)
    return major === 14 && (minor > 3 || (minor === 3 && patch >= 3))
}
it("requires a patched direct markdown parser floor", () => {
    const pkg = JSON.parse(readFileSync(new NodeURL("../../package.json", import.meta.url), "utf8"))
    expect(patched(pkg.dependencies["markdown-it"])).toBe(true)
})
it("locks a patched markdown parser", () => {
    const lock = JSON.parse(readFileSync(new NodeURL("../../../../../package-lock.json", import.meta.url), "utf8"))
    expect(patched(lock.packages["node_modules/markdown-it"].version)).toBe(true)
})
it("renders ordinary help and table markup through the studio caller", () => {
    const node = document.createElement("div")
    renderMarkdown(node, "# Help\n\n| A | B |\n|---|---|\n| one | two |\n\n[Guide](https://synthetic.invalid/help)")
    expect(node.querySelector("h1")?.textContent).toBe("Help")
    expect(node.querySelector("table")?.textContent).toContain("one")
    expect(node.querySelector("a")?.target).toBe("_blank")
})
// Dependency assertions above enforce the security floor; these small fixtures are
// rendering smoke checks, deliberately avoiding platform-dependent timing thresholds.
for (const [label, fixture] of [["title", '[a]: /u "' + 'x\n'.repeat(500)], ["label", '[' + 'a\n'.repeat(500)]]) {
    it(`renders a small unclosed multiline reference ${label}`, () => {
        const node = document.createElement("div")
        renderMarkdown(node, fixture)
        expect(node.textContent?.length).toBeGreaterThan(0)
    })
}
