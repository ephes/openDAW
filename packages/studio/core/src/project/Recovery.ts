import {Option, Provider, UUID} from "@opendaw/lib-std"
import {Project} from "./Project"
import type {ProjectEnv} from "./ProjectEnv"
import {ProjectMeta} from "./ProjectMeta"
import {ProjectProfile} from "./ProjectProfile"
import {Workers} from "../Workers"

export class Recovery {
    static readonly #ROOT = ".backup"
    static readonly #LOCK = "opendaw:recovery"
    static readonly #GENERATION = /^\d{16}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    static readonly #FILES = ["uuid", "project.od", "meta.json", "saved"] as const

    constructor(readonly projectProfileProvider: Provider<Option<ProjectProfile>>, readonly env: ProjectEnv) {}

    // Each pointer is written to a fresh path. A short write cannot destroy the
    // previous pointer; an incomplete JSON pointer is never admitted.
    static async #latest(folder: string): Promise<string | undefined> {
        const entries = await Workers.Opfs.list(`${Recovery.#ROOT}/${folder}`)
        const names: string[] = []
        for (const {name, kind} of entries) {
            if (kind !== "file" || !Recovery.#GENERATION.test(name)) {continue}
            const bytes = await Workers.Opfs.read(`${Recovery.#ROOT}/${folder}/${name}`)
            try {
                const pointer = JSON.parse(new TextDecoder().decode(bytes))
                if (pointer?.version === 1 && pointer.generation === name) {names.push(name)}
            } catch { /* Ignore incomplete publication/consumption markers. */ }
        }
        return names.sort().at(-1)
    }

    async restoreProfile(): Promise<Option<ProjectProfile>> {
        return navigator.locks.request(Recovery.#LOCK, async () => {
            let loaded: Project | undefined
            try {
                const latest = await Recovery.#latest("commits")
                const consumed = await Recovery.#latest("consumed")
                if (consumed !== undefined && (latest === undefined || latest <= consumed)) {return Option.None}
                const folder = latest === undefined ? Recovery.#ROOT : `${Recovery.#ROOT}/generations/${latest}`
                if (latest === undefined && (await Workers.Opfs.list(folder)).length === 0) {return Option.None}
                const [id, bytes, metadata, savedBytes] = await Promise.all(
                    Recovery.#FILES.map(file => Workers.Opfs.read(`${folder}/${file}`)))
                const uuid = UUID.validateBytes(id)
                const meta = JSON.parse(new TextDecoder().decode(metadata))
                if (meta === null || typeof meta !== "object"
                    || !["name", "artist", "description", "created", "modified"].every(key => typeof meta[key] === "string")
                    || !Array.isArray(meta.tags) || !meta.tags.every((tag: unknown) => typeof tag === "string")
                    || savedBytes.length !== 1 || (savedBytes[0] !== 0 && savedBytes[0] !== 1)) {
                    throw new Error("Invalid recovery metadata")
                }
                loaded = await Project.loadAnyVersion(this.env, bytes.slice().buffer)
                const profile = new ProjectProfile(uuid, loaded, meta as ProjectMeta, Option.None, savedBytes[0] === 1)
                if (latest !== undefined) {
                    await Workers.Opfs.write(`${Recovery.#ROOT}/consumed/${latest}`,
                        new TextEncoder().encode(JSON.stringify({version: 1, generation: latest})))
                }
                // Consumption is committed only after constructing a usable profile.
                const paths = latest === undefined ? Recovery.#FILES.map(file => `${folder}/${file}`)
                    : [folder, `${Recovery.#ROOT}/commits/${latest}`]
                const cleanup = await Promise.allSettled(paths.map(path => Workers.Opfs.delete(path)))
                if (cleanup.some(result => result.status === "rejected")) {console.warn("Recovery accepted; backup cleanup incomplete")}
                loaded = undefined
                return Option.wrap(profile)
            } catch {
                loaded?.terminate()
                console.warn("Recovery unavailable; backup retained for retry")
                return Option.None
            }
        })
    }

    createBackupCommand(): Option<Provider<Promise<void>>> {
        return this.projectProfileProvider().map(profile => async () => {
            // Acquire one immutable snapshot before waiting for cooperating tabs.
            const data = [profile.uuid.slice(), new Uint8Array(profile.project.toArrayBuffer()),
                new TextEncoder().encode(JSON.stringify(profile.meta)), new Uint8Array([profile.saved() ? 1 : 0])]
            return navigator.locks.request(Recovery.#LOCK, async () => {
                const latest = await Recovery.#latest("commits")
                const consumed = await Recovery.#latest("consumed")
                const sequence = Math.max(Date.now(), Number(latest?.slice(0, 16) ?? 0) + 1,
                    Number(consumed?.slice(0, 16) ?? 0) + 1)
                const generation = `${String(sequence).padStart(16, "0")}-${UUID.toString(UUID.generate())}`
                const folder = `${Recovery.#ROOT}/generations/${generation}`
                for (let i = 0; i < Recovery.#FILES.length; i++) {
                    await Workers.Opfs.write(`${folder}/${Recovery.#FILES[i]}`, data[i])
                }
                await Workers.Opfs.write(`${Recovery.#ROOT}/commits/${generation}`,
                    new TextEncoder().encode(JSON.stringify({version: 1, generation})))
            })
        })
    }
}
