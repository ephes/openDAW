import {isDefined} from "@opendaw/lib-std"
import {OpfsProtocol} from "@opendaw/lib-fusion"

const normalize = (path: string): string => path.replace(/^\/+|\/+$/g, "")

export class InMemoryOpfs implements OpfsProtocol {
    readonly files = new Map<string, Uint8Array>()

    async write(path: string, data: Uint8Array): Promise<void> {
        this.files.set(normalize(path), new Uint8Array(data))
    }

    async read(path: string): Promise<Uint8Array> {
        const data = this.files.get(normalize(path))
        if (!isDefined(data)) {throw new Error(`No such file: ${path}`)}
        return new Uint8Array(data)
    }

    async exists(path: string): Promise<boolean> {
        const normalized = normalize(path)
        if (this.files.has(normalized)) {return true}
        const prefix = normalized === "" ? "" : `${normalized}/`
        for (const key of this.files.keys()) {
            if (key.startsWith(prefix) && key !== normalized) {return true}
        }
        return false
    }

    async delete(path: string): Promise<void> {
        const normalized = normalize(path)
        if (normalized === "") {this.files.clear(); return}
        const prefix = `${normalized}/`
        for (const key of [...this.files.keys()]) {
            if (key === normalized || key.startsWith(prefix)) {this.files.delete(key)}
        }
    }

    async list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>> {
        const normalized = normalize(path)
        const prefix = normalized === "" ? "" : `${normalized}/`
        const seen = new Map<string, OpfsProtocol.Entry>()
        for (const key of this.files.keys()) {
            if (!key.startsWith(prefix)) {continue}
            const remainder = key.slice(prefix.length)
            if (remainder.length === 0) {continue}
            const slashIndex = remainder.indexOf("/")
            if (slashIndex === -1) {
                seen.set(remainder, {name: remainder, kind: "file"})
            } else {
                const dirName = remainder.slice(0, slashIndex)
                if (!seen.has(dirName)) {seen.set(dirName, {name: dirName, kind: "directory"})}
            }
        }
        return [...seen.values()]
    }

    async size(path: string): Promise<number> {
        const data = this.files.get(normalize(path))
        if (!isDefined(data)) {throw new Error(`No such file: ${path}`)}
        return data.byteLength
    }
}
