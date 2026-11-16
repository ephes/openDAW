import type {Dropbox, DropboxResponse, files} from "dropbox"
import {Errors, isDefined} from "@opendaw/lib-std"
import {network} from "@opendaw/lib-runtime"
import {CloudHandler} from "./CloudHandler"
import {InventoryBudget} from "./InventoryBudget"
import {checkCloudResponse, cloudDownloadLimit, cloudFetch, CloudError, cloudOperation} from "./CloudExchange"

export class DropboxHandler implements CloudHandler {
    readonly #accessToken: string

    constructor(accessToken: string) {this.#accessToken = accessToken}

    alive(signal?: AbortSignal): Promise<void> {
        return cloudOperation("alive", signal, async signal => {
            const client = await this.#client(signal)
            await client.usersGetCurrentAccount()
        })
    }

    upload(path: string, buffer: ArrayBuffer, signal?: AbortSignal): Promise<void> {
        return cloudOperation("upload", signal, async signal => {
            const client = await this.#client(signal)
            signal.throwIfAborted()
            await client.filesUpload({path: this.#getFullPath(path), contents: buffer, mode: {".tag": "overwrite"}})
        }, buffer.byteLength)
    }

    download(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
        return cloudOperation("download", signal, async signal => {
            const client = await this.#client(signal, cloudDownloadLimit(path))
            try {
                const response = await client.filesDownload({path: this.#getFullPath(path)})
                signal.throwIfAborted()
                const {result: {fileBlob}} = response as DropboxResponse<files.FileMetadata & {fileBlob: Blob}>
                // The SDK receives a bounded response through its public fetch hook.
                const buffer = await fileBlob.arrayBuffer()
                signal.throwIfAborted()
                return buffer
            } catch (error) {
                if (this.#isNotFoundError(error)) {throw new Errors.FileNotFound("Cloud object")}
                throw error
            }
        }, cloudDownloadLimit(path))
    }

    exists(path: string, signal?: AbortSignal): Promise<boolean> {
        return cloudOperation("exists", signal, async signal => {
            const client = await this.#client(signal)
            try {
                await client.filesGetMetadata({path: this.#getFullPath(path)})
                return true
            } catch (error) {
                if (this.#isNotFoundError(error)) {return false}
                throw error
            }
        })
    }

    list(path?: string, signal?: AbortSignal): Promise<string[]> {
        return cloudOperation("list", signal, async signal => {
            const client = await this.#client(signal)
            const fullPath = path ? this.#getFullPath(path) : ""
            let response = await client.filesListFolder({path: fullPath})
            const budget = new InventoryBudget()
            const names: string[] = []
            for (;;) {
                signal.throwIfAborted()
                budget.admit(response.result.entries.length, response.result.has_more ? response.result.cursor : undefined)
                for (const entry of response.result.entries) {if (isDefined(entry.name)) {names.push(entry.name)}}
                if (!response.result.has_more) {return names}
                response = await client.filesListFolderContinue({cursor: response.result.cursor})
            }
        })
    }

    delete(path: string, signal?: AbortSignal): Promise<void> {
        return cloudOperation("delete", signal, async signal => {
            const client = await this.#client(signal)
            try {await client.filesDeleteV2({path: this.#getFullPath(path)})} catch (error) {
                if (!this.#isNotFoundError(error, "path_lookup")) {throw error}
            }
        })
    }

    async #client(signal: AbortSignal, downloadLimit?: number): Promise<Dropbox> {
        signal.throwIfAborted()
        const {Dropbox} = await import("dropbox")
        signal.throwIfAborted()
        return new Dropbox({accessToken: this.#accessToken, fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            signal.throwIfAborted()
            const response = await cloudFetch(input, {...init, signal})
            if (signal.aborted) {
                void response.body?.cancel().catch(() => {})
                signal.throwIfAborted()
            }
            // Only 409 needs the bounded structured SDK classifier for missing paths.
            if (response.status !== 409) {checkCloudResponse(response, "request")}
            try {
                const bytes = await network.readBounded(response, response.ok && downloadLimit !== undefined
                    ? downloadLimit : 1024 * 1024, signal)
                return new Response(bytes, {status: response.status, statusText: response.statusText, headers: response.headers})
            } catch (error) {
                signal.throwIfAborted()
                throw new CloudError(error instanceof network.ResponseReadError
                    ? error.message : "Cloud body read failed", response.ok ? undefined : response.status,
                    // Transport failures mid-body stay retryable like the same failure during headers.
                    error instanceof TypeError)
            }
        }})
    }

    #getFullPath(path: string): string {
        const filename = path.replace(/:/g, "-")
        return filename.startsWith("/") ? filename : `/${filename}`
    }

    #isNotFoundError(error: unknown, tag: "path" | "path_lookup" = "path"): boolean {
        if (typeof error !== "object" || error === null || !("status" in error) || error.status !== 409) {return false}
        const detail = (error as {error?: {error?: {
            ".tag"?: string, path?: {".tag"?: string}, path_lookup?: {".tag"?: string}
        }}}).error?.error
        return detail?.[".tag"] === tag && detail[tag]?.[".tag"] === "not_found"
    }
}
