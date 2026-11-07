import type {Dropbox, DropboxResponse, files} from "dropbox"
import {Errors, isDefined, Option, panic} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {CloudHandler} from "./CloudHandler"

export class DropboxHandler implements CloudHandler {
    readonly #accessToken: string

    #dropboxClient: Option<Dropbox> = Option.None

    constructor(accessToken: string) {this.#accessToken = accessToken}

    async alive(): Promise<void> {
        const client = await this.#ensureClient()
        const {status, error} = await Promises.tryCatch(client.usersGetCurrentAccount())
        if (status === "rejected") return panic(error)
    }

    async upload(path: string, buffer: ArrayBuffer): Promise<void> {
        const client = await this.#ensureClient()
        const fullPath = this.#getFullPath(path)
        console.debug("[Dropbox] Uploading to:", fullPath)
        const {status, error, value: result} = await Promises.tryCatch(client
            .filesUpload({path: fullPath, contents: buffer, mode: {".tag": "overwrite"}}))
        if (status === "rejected") {
            return panic(error)
        } else {
            console.debug("[Dropbox] Upload successful:", result.result.path_display)
        }
    }

    async download(path: string): Promise<ArrayBuffer> {
        const client = await this.#ensureClient()
        const fullPath = this.#getFullPath(path)
        try {
            const response = await client.filesDownload({path: fullPath})
            const {result: {fileBlob}} = response as DropboxResponse<files.FileMetadata & { fileBlob: Blob }>
            return fileBlob.arrayBuffer()
        } catch (error) {
            if (this.#isNotFoundError(error)) {
                throw new Errors.FileNotFound(path)
            }
            throw error
        }
    }

    async exists(path: string): Promise<boolean> {
        const client = await this.#ensureClient()
        const fullPath = this.#getFullPath(path)
        const {
            status,
            error
        } = await Promises.tryCatch(client.filesGetMetadata({path: fullPath})).catch(error => error as {status: "rejected", error: unknown})
        if (status === "resolved") return true
        return this.#isNotFoundError(error) ? false : panic(error)
    }

    async list(path?: string): Promise<Array<string>> {
        const client = await this.#ensureClient()
        const fullPath = path ? this.#getFullPath(path) : ""
        let response = await client.filesListFolder({path: fullPath})
        const names = response.result.entries.map(entry => entry.name).filter(isDefined)
        while (response.result.has_more) {
            response = await client.filesListFolderContinue({cursor: response.result.cursor})
            names.push(...response.result.entries.map(entry => entry.name).filter(isDefined))
        }
        return names
    }

    async delete(path: string): Promise<void> {
        const client = await this.#ensureClient()
        const fullPath = this.#getFullPath(path)
        await client.filesDeleteV2({path: fullPath})
    }

    async #ensureClient(): Promise<Dropbox> {
        if (this.#dropboxClient.isEmpty()) {
            const DropboxModule = await import("dropbox")
            this.#dropboxClient = Option.wrap(new DropboxModule.Dropbox({accessToken: this.#accessToken}))
        }
        return this.#dropboxClient.unwrap()
    }

    #getFullPath(path: string): string {
        if (path.includes(":") || path.includes("T")) {
            const filename = path.replace(/:/g, "-")
            return filename.startsWith("/") ? filename : `/${filename}`
        }
        return path.startsWith("/") ? path : `/${path}`
    }

    #isNotFoundError(error: unknown): boolean {
        return (
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            error.status === 409 &&
            (error as {error?: {error?: {".tag"?: string, path?: {".tag"?: string}}}}).error?.error?.[".tag"] === "path" &&
            (error as {error?: {error?: {".tag"?: string, path?: {".tag"?: string}}}}).error?.error?.path?.[".tag"] === "not_found"
        )
    }
}