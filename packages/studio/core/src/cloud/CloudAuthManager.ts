import {Errors, Maps, panic, RuntimeNotifier, TimeSpan} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {CloudService} from "./CloudService"
import {CloudHandler} from "./CloudHandler"
import {DropboxHandler} from "./DropboxHandler"
import {GoogleDriveHandler} from "./GoogleDriveHandler"

type ClientIds = {
    Dropbox: string
    GoogleDrive: string
}

export class CloudAuthManager {
    static create(clientIds: ClientIds): CloudAuthManager {return new CloudAuthManager(clientIds)}

    static async #createCodes(): Promise<{ codeVerifier: string; codeChallenge: string }> {
        const array = new Uint8Array(32)
        crypto.getRandomValues(array)
        const codeVerifier = btoa(String.fromCharCode(...array))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")
        const encoder = new TextEncoder()
        const data = encoder.encode(codeVerifier)
        const digest = await crypto.subtle.digest("SHA-256", data)
        const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")
        return {codeVerifier, codeChallenge}
    }

    readonly #clientIds: ClientIds

    readonly #memoizedHandlers = new Map<CloudService, () => Promise<CloudHandler>>()

    private constructor(clientIds: ClientIds) {this.#clientIds = clientIds}

    async getHandler(service: CloudService): Promise<CloudHandler> {
        const memo = Maps.createIfAbsent(this.#memoizedHandlers, service, service => {
            switch (service) {
                case "Dropbox": {
                    return Promises.memoizeAsync(this.#oauthDropbox.bind(this), TimeSpan.hours(1))
                }
                case "GoogleDrive": {
                    return Promises.memoizeAsync(this.#oauthGoogle.bind(this), TimeSpan.hours(1))
                }
                default:
                    return panic(`Unsupported service: ${service}`)
            }
        })
        const handler = await memo()
        const {status} = await Promises.tryCatch(handler.alive())
        if (status === "rejected") {
            // Do not auto-retry here to avoid reopening the OAuth popup in a loop.
            // Instead, clear the memoized handler and surface the error to the caller.
            this.#memoizedHandlers.delete(service)
            throw new Error("Cloud authentication check failed")
        }
        console.debug(`Handler for '${service}' is alive`)
        return handler
    }

    async #oauthPkceFlow(config: {
        service: string
        clientId: string
        authUrlBase: string
        tokenUrl: string
        scope: string
        extraAuthParams?: Record<string, string>
        extraTokenParams?: Record<string, string>
    }): Promise<CloudHandler> {
        const redirectUri = `${location.origin}/auth-callback.html`
        const {codeVerifier, codeChallenge} = await CloudAuthManager.#createCodes()
        const params = new URLSearchParams({
            client_id: config.clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: config.scope,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            ...(config.extraAuthParams ?? {})
        })
        return this.#authorize(config.service, config.authUrlBase, params, async (data, signal) => {
            if (typeof data.code !== "string" || data.code.length === 0) {throw new Error("Invalid authentication response")}
            const tokenParams = new URLSearchParams({
                code: data.code,
                grant_type: "authorization_code",
                client_id: config.clientId,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
                ...(config.extraTokenParams ?? {})
            })
            const response = await fetch(config.tokenUrl, {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded"},
                body: tokenParams.toString(), signal
            })
            if (!response.ok) {throw new Error(`Token exchange failed (HTTP ${response.status})`)}
            const result = await response.json()
            if (typeof result?.access_token !== "string" || result.access_token.length === 0) {
                throw new Error("Invalid token response")
            }
            return result.access_token
        })
    }

    async #authorize(service: string, authUrlBase: string, params: URLSearchParams,
                     readToken: (data: Record<string, unknown>, signal: AbortSignal) => Promise<string>): Promise<CloudHandler> {
        const state = `${service}.${crypto.randomUUID()}`
        params.set("state", state)
        const channel = new BroadcastChannel("auth-callback")
        const authWindow = window.open(`${authUrlBase}?${params}`, `cloudAuth-${state}`)
        if (authWindow === null) {
            channel.close()
            return Errors.warn("Failed to open authentication window. Please check popup blockers.")
        }
        const {resolve, reject, promise} = Promise.withResolvers<CloudHandler>()
        const controller = new AbortController()
        let phase: "waiting" | "handling" | "settled" = "waiting"
        const fail = (message: string) => {
            if (phase === "settled") {return}
            phase = "settled"
            controller.abort()
            reject(new Error(message))
        }
        const dialog = RuntimeNotifier.progress({
            headline: "Cloud Service", message: "Please wait for authentication...",
            cancel: () => fail("Authentication cancelled")
        })
        const deadline = setTimeout(() => fail("Authentication timed out"), 5 * 60_000)
        // COOP severs cross-origin popup proxies; `closed` cannot distinguish a
        // live provider popup from a user-closed one. Use callback messages/deadline.
        channel.onmessage = async (event: MessageEvent) => {
            const data = event.data
            if (phase !== "waiting" || data === null || typeof data !== "object"
                || data.state !== state || data.service !== service) {return}
            if (data.type === "closed") {fail("Authentication window closed"); return}
            if (data.type === "auth-error") {fail("Authentication rejected by provider"); return}
            if (data.type !== "auth-callback") {return}
            phase = "handling"
            try {
                const token = await readToken(data, controller.signal)
                if (controller.signal.aborted) {return}
                const handler = await this.#createHandler(service, token)
                if (controller.signal.aborted) {return}
                phase = "settled"
                resolve(handler)
            } catch {
                // Provider bodies, codes, tokens and raw exceptions must never become diagnostics.
                fail("Authentication failed")
            }
        }
        return promise.finally(() => {
            clearTimeout(deadline)
            channel.onmessage = null
            channel.close()
            authWindow.close()
            dialog.terminate()
        })
    }

    async #oauthDropbox(): Promise<CloudHandler> {
        return this.#oauthPkceFlow({
            service: "dropbox",
            clientId: this.#clientIds.Dropbox,
            authUrlBase: "https://www.dropbox.com/oauth2/authorize",
            tokenUrl: "https://api.dropboxapi.com/oauth2/token",
            scope: "", // Dropbox scope is optional
            extraAuthParams: {
                token_access_type: "offline"
            }
        })
    }

    async #oauthGoogle(): Promise<CloudHandler> {
        const clientId = this.#clientIds.GoogleDrive
        const scope = "https://www.googleapis.com/auth/drive.appdata"
        const redirectUri = `${location.origin}/auth-callback.html`
        const params = new URLSearchParams({
            client_id: clientId,
            response_type: "token",
            redirect_uri: redirectUri,
            scope,
            include_granted_scopes: "true",
            prompt: "consent"
        })
        return this.#authorize("google", "https://accounts.google.com/o/oauth2/v2/auth", params, async data => {
            if (typeof data.access_token !== "string" || data.access_token.length === 0) {
                throw new Error("Invalid authentication response")
            }
            return data.access_token
        })
    }

    async #createHandler(service: string, token: string): Promise<CloudHandler> {
        switch (service) {
            case "dropbox": {
                return new DropboxHandler(token)
            }
            case "google": {
                return new GoogleDriveHandler(token)
            }
            default:
                return panic(`Handler not implemented for service: ${service}`)
        }
    }
}