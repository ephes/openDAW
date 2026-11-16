export interface CloudHandler {
    upload(path: string, data: ArrayBuffer, signal?: AbortSignal): Promise<void>
    exists(path: string, signal?: AbortSignal): Promise<boolean>
    download(path: string, signal?: AbortSignal): Promise<ArrayBuffer>
    list(path?: string, signal?: AbortSignal): Promise<string[]>
    delete(path: string, signal?: AbortSignal): Promise<void>
    alive(signal?: AbortSignal): Promise<void>
}