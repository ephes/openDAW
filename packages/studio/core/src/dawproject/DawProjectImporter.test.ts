import {describe, expect, it} from "vitest"
import {fileURLToPath} from "url"
import * as path from "node:path"
import * as fs from "node:fs"
import {AuxSendBox} from "@opendaw/studio-boxes"
import {DawProject} from "./DawProject"
import {DawProjectImport} from "./DawProjectImporter"

describe("DawProjectImport", () => {
    it("import", async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        const testFile = "../../../../../test-files/eq.dawproject"
        const buffer = fs.readFileSync(path.join(__dirname, testFile))
        const {project, resources} = await DawProject.decode(buffer)
        // The Bitwig export declares a disabled self-send on its FX channel; it must still import.
        const {skeleton} = await DawProjectImport.read(project, resources)
        expect(() => skeleton.boxGraph.verifyPointers()).not.toThrow()
        expect(skeleton.boxGraph.boxes().filter(box => box instanceof AuxSendBox)).toHaveLength(1)
    })
})