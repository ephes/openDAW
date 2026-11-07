import {expect, it} from "vitest"
import {readFileSync, readdirSync} from "node:fs"
import {URL as NodeURL} from "node:url"
import {createServer} from "node:http"
import DOMPurify from "dompurify"
import axios from "axios"
import FormData from "form-data"
import protobuf from "protobufjs"
import * as sass from "sass"

const versions = {dompurify: "3.4.17", axios: "1.20.0", "follow-redirects": "1.16.2",
    "form-data": "4.0.6", protobufjs: "7.6.5", immutable: "5.1.8"}
for (const [name, version] of Object.entries(versions)) {
    it(`locks every ${name} copy to the scoped security patch`, () => {
        const lock = JSON.parse(readFileSync(new NodeURL("../../../../../package-lock.json", import.meta.url), "utf8"))
        const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith(`node_modules/${name}`))
        expect(copies.length).toBeGreaterThan(0)
        for (const [, entry] of copies) {expect((entry as {version: string}).version).toBe(version)}
    })
}
it("retains safe help markup and strips executable editor markup", () => {
    const safe = DOMPurify.sanitize('<p>Help <strong>bold</strong></p><img src=x onerror=alert(1)><script>alert(1)</script>')
    expect(safe).toContain("<strong>bold</strong>")
    expect(safe).not.toMatch(/onerror|script/)
    expect(DOMPurify.sanitize('<a href="javascript:alert(1)">link</a>')).toBe('<a>link</a>')
})
it("follows a loopback POST redirect without forwarding body headers to GET", async () => {
    const server = createServer((req, res) => {
        if (req.url === "/redirect") {res.writeHead(303, {location: "/final"}); res.end()}
        else {res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({method: req.method, contentType: req.headers["content-type"] ?? null}))}
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    try {
        const address = server.address() as {port: number}
        const form = new FormData()
        form.append("synthetic", "fixture")
        const response = await axios.post(`http://127.0.0.1:${address.port}/redirect`, form, {adapter: "http", proxy: false})
        expect(response.data).toEqual({method: "GET", contentType: null})
    } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))}
})
it("roundtrips a tiny synthetic model message without fetching model assets", () => {
    const type = protobuf.parse('syntax = "proto3"; message Model { string name = 1; repeated float weights = 2; }').root.lookupType("Model")
    const bytes = type.encode(type.create({name: "synthetic", weights: [0.5, -1]})).finish()
    expect(type.toObject(type.decode(bytes))).toEqual({name: "synthetic", weights: [0.5, -1]})
})
it("compiles a synthetic Sass style through the patched immutable dependency", () => {
    expect(sass.compileString('$color: #123456; .fixture { color: $color; }').css).toContain("color: #123456")
})

it("bundles the patched sanitizer into Monaco's editor runtime", () => {
    const folder = new NodeURL("../../dist/", import.meta.url)
    const editors = readdirSync(folder).filter(name => /^editor\.main\..*\.js$/.test(name))
    expect(editors.length).toBeGreaterThan(0)
    for (const editor of editors) {
        const source = readFileSync(new NodeURL(editor, folder), "utf8")
        expect(source.includes("3.4.17")).toBe(true)
        expect(/DOMPurify 3\.1\.7|\.version\s*=\s*["']3\.1\.7["']/.test(source)).toBe(false)
    }
})
