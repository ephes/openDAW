import {describe, expect, it} from "vitest"
import {fileURLToPath} from "url"
import * as path from "node:path"
import * as fs from "node:fs"
import {Xml} from "@opendaw/lib-xml"
import {ProjectSchema} from "@opendaw/lib-dawproject"
import {DawProject} from "./DawProject"
import {DawProjectImport} from "./DawProjectImporter"

describe("DawProjectImport", () => {
    it("import", async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        const testFile = "../../../../../test-files/eq.dawproject"
        const buffer = fs.readFileSync(path.join(__dirname, testFile))
        const {project, resources} = await DawProject.decode(buffer)
        // The legacy fixture declares a disabled aux self-send. Refuse the declared
        // feedback topology instead of relying on its current enable/gain values.
        await expect(DawProjectImport.read(project, resources)).rejects.toThrow(/feedback routing/)
        const element = Xml.toElement("Project", project)
        element.querySelector('Send[id="id54"]')!.remove()
        const {skeleton} = await DawProjectImport.read(Xml.parse(Xml.pretty(element), ProjectSchema), resources)
        expect(() => skeleton.boxGraph.verifyPointers()).not.toThrow()
    })
})