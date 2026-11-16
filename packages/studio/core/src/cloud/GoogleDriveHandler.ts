import {CloudHandler} from "./CloudHandler"
import {network} from "@opendaw/lib-runtime"
import {checkCloudResponse, cloudDownloadLimit, cloudFetch, CloudError, cloudJson, cloudOperation} from "./CloudExchange"
import {InventoryBudget} from "./InventoryBudget"
import {assert, Errors, isDefined, Option} from "@opendaw/lib-std"

type DriveFile = {
    id: string
    name: string
    mimeType?: string
}

type DriveListResponse = {
    files: Array<DriveFile>
    nextPageToken?: string
}

const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files"
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
const FOLDER_MIME = "application/vnd.google-apps.folder"
const ROOT_ID = "appDataFolder"
const escapeLiteral = (value: string): string => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")

export class GoogleDriveHandler implements CloudHandler {
    readonly #accessToken: string

    #ensureFolderInProgress: boolean = false

    constructor(accessToken: string) {this.#accessToken = accessToken}

    alive(signal?: AbortSignal): Promise<void> {
        return cloudOperation("alive", signal, signal => this.#alive(signal))
    }

    async #alive(signal: AbortSignal): Promise<void> {
        const params = new URLSearchParams({
            q: `'${ROOT_ID}' in parents and trashed = false`,
            fields: "files(id)",
            pageSize: "1",
            spaces: "appDataFolder"
        })
        const res = await cloudFetch(`${DRIVE_FILES_API}?${params.toString()}`, {headers: this.#authHeaders(), signal})
        checkCloudResponse(res, "ping")
        void res.body?.cancel().catch(() => {})
    }

    upload(path: string, data: ArrayBuffer, signal?: AbortSignal): Promise<void> {
        return cloudOperation("upload", signal, signal => this.#upload(path, data, signal))
    }

    async #upload(path: string, data: ArrayBuffer, signal: AbortSignal): Promise<void> {
        signal?.throwIfAborted()
        const {dir, base} = this.#splitPath(path)
        const parentId = await this.#ensureFolderPath(dir, signal)
        signal?.throwIfAborted()
        const existing = await this.#findFileInFolder(base, parentId, false, signal)
        signal?.throwIfAborted()
        if (existing.nonEmpty()) {
            const fileId = existing.unwrap().id
            const res = await cloudFetch(`${DRIVE_UPLOAD_API}/${fileId}?uploadType=media`, {
                method: "PATCH", signal,
                headers: {
                    Authorization: `Bearer ${this.#accessToken}`,
                    "Content-Type": "application/octet-stream"
                },
                body: data
            })
            checkCloudResponse(res, "update")
            void res.body?.cancel().catch(() => {})
        } else {
            const meta = {name: base, parents: [parentId]}
            const {boundary, body} = this.#buildMultipartBody(meta, data)
            const res = await cloudFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
                method: "POST", signal,
                headers: {
                    Authorization: `Bearer ${this.#accessToken}`,
                    "Content-Type": `multipart/related; boundary=${boundary}`
                },
                body
            })
            checkCloudResponse(res, "upload")
            void res.body?.cancel().catch(() => {})
        }
    }

    download(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
        return cloudOperation("download", signal, signal => this.#download(path, signal))
    }

    async #download(path: string, signal: AbortSignal): Promise<ArrayBuffer> {
        const fileId = await this.#resolveFileIdByPath(path, false, signal)
        if (fileId.isEmpty()) {throw new Errors.FileNotFound("Cloud object")}
        const res = await cloudFetch(`${DRIVE_FILES_API}/${fileId.unwrap()}?alt=media`, {
            method: "GET", signal,
            headers: {"Authorization": `Bearer ${this.#accessToken}`}
        })
        if (!res.ok) {
            if (res.status === 404) {
                void res.body?.cancel().catch(() => {})
                throw new Errors.FileNotFound("Cloud object")
            }
            checkCloudResponse(res, "download")
        }
        try {return await network.readBounded(res, cloudDownloadLimit(path), signal)} catch (error) {
            signal.throwIfAborted()
            throw new CloudError(error instanceof network.ResponseReadError ? error.message : "Cloud body read failed")
        }
    }

    exists(path: string, signal?: AbortSignal): Promise<boolean> {
        return cloudOperation("exists", signal, signal => this.#exists(path, signal))
    }

    async #exists(path: string, signal: AbortSignal): Promise<boolean> {
        const fileId = await this.#resolveFileIdByPath(path, false, signal)
        return fileId.nonEmpty()
    }

    list(path?: string, signal?: AbortSignal): Promise<string[]> {
        return cloudOperation("list", signal, signal => this.#list(path, signal))
    }

    async #list(path: string | undefined, signal: AbortSignal): Promise<string[]> {
        const folderId = await this.#resolveFolderId(path ?? "/", signal)
        if (folderId.isEmpty()) return []
        const q = `'${folderId.unwrap()}' in parents and trashed = false`
        const names: string[] = []
        let pageToken: string | undefined = undefined
        const budget = new InventoryBudget()
        do {
            const params = new URLSearchParams({
                q,
                fields: "files(id,name,mimeType),nextPageToken",
                pageSize: "1000",
                spaces: "appDataFolder"
            })
            if (pageToken) params.set("pageToken", pageToken)
            const res = await cloudFetch(`${DRIVE_FILES_API}?${params.toString()}`, {
                headers: {"Authorization": `Bearer ${this.#accessToken}`}, signal
            })
            if (!res.ok) {
                checkCloudResponse(res, "list")
            }
            const json: DriveListResponse = await cloudJson<DriveListResponse>(res, signal)
            budget.admit(json.files.length, json.nextPageToken)
            json.files.forEach(f => names.push(f.name))
            pageToken = json.nextPageToken
        } while (isDefined(pageToken))
        return names
    }

    delete(path: string, signal?: AbortSignal): Promise<void> {
        return cloudOperation("delete", signal, signal => this.#delete(path, signal))
    }

    async #delete(path: string, signal: AbortSignal): Promise<void> {
        const fileId = await this.#resolveFileIdByPath(path, true, signal)
        if (fileId.isEmpty()) {
            // deleting a non-existent file should be a no-op
            return
        }
        const res = await cloudFetch(`${DRIVE_FILES_API}/${fileId.unwrap()}`, {
            method: "DELETE", signal,
            headers: {"Authorization": `Bearer ${this.#accessToken}`}
        })
        if (!res.ok && res.status !== 404) {checkCloudResponse(res, "delete")}
        void res.body?.cancel().catch(() => {})
    }

    // ---------- Helpers ----------

    #authHeaders(): HeadersInit {
        return {"Authorization": `Bearer ${this.#accessToken}`}
    }

    #splitPath(path: string): { dir: string[]; base: string } {
        const clean = path.replace(/^\/*/, "") // remove leading slashes
        const parts = clean.split("/").filter(p => p.length > 0)
        if (parts.length === 0) return {dir: [], base: ""}
        const base = parts.pop() as string
        return {dir: parts, base}
    }

    async #resolveFileIdByPath(path: string, includeFolders = false, signal?: AbortSignal): Promise<Option<string>> {
        const {dir, base} = this.#splitPath(path)
        const parentId = await this.#resolveFolderPath(dir, signal)
        if (parentId.isEmpty() || base.length === 0) return Option.None
        const existing = await this.#findFileInFolder(base, parentId.unwrap(), includeFolders, signal)
        return existing.map(f => f.id)
    }

    async #resolveFolderId(path: string, signal?: AbortSignal): Promise<Option<string>> {
        if (path === "/" || path.trim() === "") return Option.wrap(ROOT_ID)
        const parts = path.replace(/^\/*/, "").split("/").filter(Boolean)
        return this.#resolveFolderPath(parts, signal)
    }

    // Resolve a folder path without creating anything
    async #resolveFolderPath(parts: string[], signal?: AbortSignal): Promise<Option<string>> {
        let currentId: string = ROOT_ID
        for (const part of parts) {
            const next = await this.#findFolderInFolder(part, currentId, signal)
            if (next.isEmpty()) return Option.None
            currentId = next.unwrap().id
        }
        return Option.wrap(currentId)
    }

    async #ensureFolderPath(parts: string[], signal?: AbortSignal): Promise<string> {
        // We found a bug when writing multiple files at a yet non-existing folder at the same time.
        // Some of them are still waiting for #ensureFolderPath to resolve.
        // Unless somebody knows how to use Google Drive's API correctly, we are stuck with that 'solution'.
        assert(!this.#ensureFolderInProgress, "Google Drive can get confused when multiple uploads are in progress")
        this.#ensureFolderInProgress = true
        try {
            let currentId: string = ROOT_ID
            for (const part of parts) {
                const found = await this.#findFolderInFolder(part, currentId, signal)
                signal?.throwIfAborted()
                if (found.nonEmpty()) {
                    currentId = found.unwrap().id
                    continue
                }
                const created = await this.#createFolder(part, currentId, signal)
                currentId = created.id
            }
            return currentId
        } finally {
            this.#ensureFolderInProgress = false
        }
    }

    async #findFolderInFolder(name: string, parentId: string, signal?: AbortSignal): Promise<Option<DriveFile>> {
        const q = [
            `name = '${escapeLiteral(name)}'`,
            `'${parentId}' in parents`,
            `mimeType = '${FOLDER_MIME}'`,
            `trashed = false`
        ].join(" and ")
        const params = new URLSearchParams({
            q,
            fields: "files(id,name,mimeType),nextPageToken",
            pageSize: "2",
            spaces: "appDataFolder"
        })
        const res = await cloudFetch(`${DRIVE_FILES_API}?${params.toString()}`, {headers: this.#authHeaders(), signal})
        checkCloudResponse(res, "query")
        const json: DriveListResponse = await cloudJson<DriveListResponse>(res, signal)
        if (json.files.length > 1 || json.nextPageToken) {
            throw new CloudError("Ambiguous Google Drive name; repair duplicate backup entries before retrying.")
        }
        return Option.wrap(json.files[0])
    }

    async #findFileInFolder(name: string, parentId: string, includeFolders = false, signal?: AbortSignal): Promise<Option<DriveFile>> {
        const q = [
            `name = '${escapeLiteral(name)}'`,
            `'${parentId}' in parents`,
            ...(includeFolders ? [] : [`mimeType != '${FOLDER_MIME}'`]),
            `trashed = false`
        ].join(" and ")
        const params = new URLSearchParams({
            q,
            fields: "files(id,name,mimeType),nextPageToken",
            pageSize: "2",
            spaces: "appDataFolder"
        })
        const res = await cloudFetch(`${DRIVE_FILES_API}?${params.toString()}`, {headers: this.#authHeaders(), signal})
        checkCloudResponse(res, "query")
        const json: DriveListResponse = await cloudJson<DriveListResponse>(res, signal)
        if (json.files.length > 1 || json.nextPageToken) {
            throw new CloudError("Ambiguous Google Drive name; repair duplicate backup entries before retrying.")
        }
        return Option.wrap(json.files[0])
    }

    async #createFolder(name: string, parentId: string, signal?: AbortSignal): Promise<DriveFile> {
        const metadata = {
            name,
            mimeType: FOLDER_MIME,
            parents: [parentId]
        }
        const res = await cloudFetch(DRIVE_FILES_API, {
            method: "POST", signal,
            headers: {
                ...this.#authHeaders(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify(metadata)
        })
        checkCloudResponse(res, "create folder")
        return await cloudJson<DriveFile>(res, signal)
    }

    #buildMultipartBody(metadata: unknown, content: ArrayBuffer): { boundary: string; body: Blob } {
        const boundary = `======opendaw_${Math.random().toString(36).slice(2)}`
        const delimiter = `--${boundary}`
        const close = `--${boundary}--`

        const metaHeader =
            `${delimiter}\r\n` +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            `${JSON.stringify(metadata)}\r\n`

        const binHeader =
            `${delimiter}\r\n` +
            "Content-Type: application/octet-stream\r\n\r\n"

        // Use ArrayBuffer (content) as BlobPart directly to satisfy TS typings
        const body = new Blob([
            metaHeader,
            binHeader,
            content,
            `\r\n${close}\r\n`
        ])
        return {boundary, body}
    }
}