import {Progress, Subscription, UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {SampleMetaData, SoundfontMetaData} from "@opendaw/studio-adapters"
import {type SignalingMessage, AssetSignaling} from "./AssetSignaling"
import {AssetPeerConnection} from "./AssetPeerConnection"
import {AssetZip} from "./AssetZip"
import * as ChunkProtocol from "./ChunkProtocol"
import {TrafficMeter} from "./TrafficMeter"

export const STALL_TIMEOUT_MS = 10_000
export const MAX_RETRIES = 3
export const MAX_TRANSFER_BYTES = 512 * 1024 * 1024
export const MAX_TRANSFER_CHUNKS = Math.ceil(MAX_TRANSFER_BYTES / ChunkProtocol.CHUNK_SIZE)

type PendingRequest = {
    readonly uuid: UUID.Bytes
    readonly uuidString: string
    readonly assetType: "sample" | "soundfont"
    readonly progress: Progress.Handler
    readonly resolve: (zipBytes: ArrayBuffer) => void
    readonly reject: (error: Error) => void
    retryCount: number
    stallTimer: ReturnType<typeof setTimeout> | null
}

export class PeerAssetProvider {
    readonly #signaling: AssetSignaling
    readonly #localPeerId: string
    readonly #trafficMeter: TrafficMeter
    readonly #connections: Map<string, AssetPeerConnection> = new Map()
    readonly #pendingRequests: Map<string, PendingRequest> = new Map()
    readonly #incomingChunks: Map<string, Map<number, Uint8Array>> = new Map()
    readonly #transferMeta: Map<string, {totalChunks: number, zipSize: number, received: number}> = new Map()
    readonly #knownPeers: Set<string> = new Set()
    readonly #transferringAssets: Map<string, string> = new Map()
    readonly #activePeerTransfers: Map<string, string> = new Map()
    readonly #peerQueues: Map<string, Array<string>> = new Map()
    readonly #subscription: Subscription
    #terminated: boolean = false

    constructor(signaling: AssetSignaling, localPeerId: string, trafficMeter?: TrafficMeter) {
        this.#signaling = signaling
        this.#localPeerId = localPeerId
        this.#trafficMeter = trafficMeter ?? new TrafficMeter()
        this.#subscription = this.#signaling.subscribe(message => this.#onSignalingMessage(message))
        console.debug("[P2P:Provider] initialized, peerId:", localPeerId)
    }

    async fetchSample(uuid: UUID.Bytes, progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> {
        console.debug("[P2P:Provider] fetchSample", UUID.toString(uuid))
        const zipBytes = await this.#requestAsset(uuid, "sample", progress)
        console.debug("[P2P:Provider] fetchSample complete, zip size:", zipBytes.byteLength)
        return AssetZip.unpackSample(zipBytes)
    }

    async fetchSoundfont(uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> {
        console.debug("[P2P:Provider] fetchSoundfont", UUID.toString(uuid))
        const zipBytes = await this.#requestAsset(uuid, "soundfont", progress)
        return AssetZip.unpackSoundfont(zipBytes)
    }

    #requestAsset(uuid: UUID.Bytes, assetType: "sample" | "soundfont", progress: Progress.Handler): Promise<ArrayBuffer> {
        if (this.#terminated) {return Promise.reject(new Error("P2P session terminated"))}
        const uuidString = UUID.toString(uuid)
        if (this.#pendingRequests.has(uuidString)) {return Promise.reject(new Error("Asset request already pending"))}
        const {promise, resolve, reject} = Promise.withResolvers<ArrayBuffer>()
        this.#pendingRequests.set(uuidString, {
            uuid, uuidString, assetType, progress, resolve, reject,
            retryCount: 0, stallTimer: null
        })
        this.#broadcastRequest(uuidString, assetType)
        return promise
    }

    #broadcastRequest(uuidString: string, assetType: string): void {
        console.debug("[P2P:Provider] broadcasting asset-request for", uuidString, assetType)
        this.#signaling.publish({
            type: "asset-request",
            peerId: this.#localPeerId,
            assets: [{uuid: uuidString, assetType}]
        })
    }

    #rebroadcastPending(): void {
        for (const pending of this.#pendingRequests.values()) {
            if (this.#transferringAssets.has(pending.uuidString)) {continue}
            this.#broadcastRequest(pending.uuidString, pending.assetType)
        }
    }

    #retryTransfer(uuidString: string, reason: string): void {
        const pending = this.#pendingRequests.get(uuidString)
        if (pending === undefined) {return}
        this.#clearTransferState(uuidString)
        pending.retryCount++
        if (pending.retryCount >= MAX_RETRIES) {
            console.warn("[P2P:Provider] max retries reached for", uuidString)
            this.#pendingRequests.delete(uuidString)
            pending.reject(new Error(`Transfer failed after ${MAX_RETRIES} retries: ${reason}`))
            return
        }
        console.debug("[P2P:Provider] retrying transfer for", uuidString, `(attempt ${pending.retryCount + 1}/${MAX_RETRIES}, reason: ${reason})`)
        this.#broadcastRequest(uuidString, pending.assetType)
    }

    #clearTransferState(uuidString: string): void {
        const remotePeerId = this.#transferringAssets.get(uuidString)
        this.#transferringAssets.delete(uuidString)
        this.#incomingChunks.delete(uuidString)
        this.#transferMeta.delete(uuidString)
        const pending = this.#pendingRequests.get(uuidString)
        if (pending !== undefined && pending.stallTimer !== null) {
            clearTimeout(pending.stallTimer)
            pending.stallTimer = null
        }
        if (remotePeerId !== undefined) {
            this.#activePeerTransfers.delete(remotePeerId)
            const connection = this.#connections.get(remotePeerId)
            if (connection !== undefined) {
                this.#connections.delete(remotePeerId)
                connection.terminate()
            }
            this.#drainPeerQueue(remotePeerId)
        }
    }

    #drainPeerQueue(peerId: string): void {
        if (this.#terminated) {return}
        const queue = this.#peerQueues.get(peerId)
        if (queue === undefined || queue.length === 0) {return}
        while (queue.length > 0) {
            const uuidString = queue.shift()!
            const pending = this.#pendingRequests.get(uuidString)
            if (pending === undefined || this.#transferringAssets.has(uuidString)) {continue}
            console.debug("[P2P:Provider] dequeuing transfer for", uuidString, "from peer", peerId)
            this.#initiateTransfer(pending, peerId)
            return
        }
        this.#peerQueues.delete(peerId)
    }

    #resetStallTimer(pending: PendingRequest): void {
        if (pending.stallTimer !== null) {
            clearTimeout(pending.stallTimer)
        }
        pending.stallTimer = setTimeout(() => {
            console.warn("[P2P:Provider] stall timeout for", pending.uuidString)
            this.#retryTransfer(pending.uuidString, "stall timeout")
        }, STALL_TIMEOUT_MS)
    }

    #onSignalingMessage(message: SignalingMessage): void {
        if (this.#terminated) {return}
        const peerId = message.peerId as string | undefined
        if (peerId !== undefined && peerId !== this.#localPeerId && !this.#knownPeers.has(peerId)) {
            this.#knownPeers.add(peerId)
            console.debug("[P2P:Provider] new peer discovered:", peerId, "- rebroadcasting pending requests")
            this.#rebroadcastPending()
        }
        switch (message.type) {
            case "asset-inventory":
                this.#onInventory(message)
                break
            case "rtc-answer":
                this.#onRtcAnswer(message).catch(error => console.warn("[P2P:Provider] error handling rtc-answer:", error))
                break
            case "rtc-ice-candidate":
                this.#onIceCandidate(message).catch(error => console.warn("[P2P:Provider] error handling rtc-ice-candidate:", error))
                break
        }
    }

    #onInventory(message: SignalingMessage): void {
        if (message.targetPeerId !== this.#localPeerId) {return}
        const peerId = message.peerId as string
        const have = message.have as ReadonlyArray<string>
        console.debug("[P2P:Provider] got inventory from", peerId, "have:", have)
        for (const uuidString of have) {
            const pending = this.#pendingRequests.get(uuidString)
            if (pending === undefined) {continue}
            if (this.#transferringAssets.has(uuidString)) {continue}
            if (this.#activePeerTransfers.has(peerId)) {
                console.debug("[P2P:Provider] peer", peerId, "busy, queuing", uuidString)
                const queue = this.#peerQueues.get(peerId) ?? []
                if (!queue.includes(uuidString)) {queue.push(uuidString)}
                this.#peerQueues.set(peerId, queue)
                continue
            }
            console.debug("[P2P:Provider] initiating transfer for", uuidString, "from peer", peerId)
            this.#initiateTransfer(pending, peerId)
            break
        }
    }

    async #initiateTransfer(pending: PendingRequest, remotePeerId: string): Promise<void> {
        if (this.#terminated || this.#pendingRequests.get(pending.uuidString) !== pending) {return}
        let connection: AssetPeerConnection | undefined
        const current = () => !this.#terminated && this.#pendingRequests.get(pending.uuidString) === pending &&
            connection !== undefined && this.#connections.get(remotePeerId) === connection
        try {
            this.#transferringAssets.set(pending.uuidString, remotePeerId)
            this.#activePeerTransfers.set(remotePeerId, pending.uuidString)
            connection = new AssetPeerConnection(this.#signaling, this.#localPeerId, remotePeerId)
            this.#connections.set(remotePeerId, connection)
            this.#resetStallTimer(pending)
            const channel = await connection.createOffer()
            if (!current()) {return}
            channel.onmessage = event => {if (current()) {this.#onDataChannelMessage(pending, event.data)}}
            channel.onerror = () => {if (current()) {this.#retryTransfer(pending.uuidString, "data channel error")}}
            channel.onclose = () => {if (current()) {this.#retryTransfer(pending.uuidString, "data channel closed")}}
            channel.onopen = () => {
                if (!current()) {return}
                try {channel.send(JSON.stringify({type: "transfer-request", uuid: pending.uuidString, assetType: pending.assetType}))}
                catch {this.#retryTransfer(pending.uuidString, "transfer setup failed")}
            }
        } catch {
            if (this.#pendingRequests.get(pending.uuidString) === pending && !this.#terminated &&
                (connection === undefined || current())) {this.#retryTransfer(pending.uuidString, "transfer setup failed")}
        }
    }

    #failTransfer(pending: PendingRequest): void {
        if (this.#pendingRequests.get(pending.uuidString) !== pending) {return}
        this.#retryTransfer(pending.uuidString, "invalid or incomplete asset transfer")
    }

    #onDataChannelMessage(pending: PendingRequest, buffer: ArrayBuffer): void {
        if (this.#pendingRequests.get(pending.uuidString) !== pending) {return}
        try {
            const message = ChunkProtocol.decode(buffer)
            if (!UUID.equals(message.assetId, pending.uuid) || ![
                ChunkProtocol.MsgType.TransferStart, ChunkProtocol.MsgType.ChunkData,
                ChunkProtocol.MsgType.TransferComplete
            ].includes(message.msgType)) {throw new Error("Invalid frame identity/type")}
            this.#trafficMeter.recordDownload(buffer.byteLength)
            const key = pending.uuidString
            switch (message.msgType) {
                case ChunkProtocol.MsgType.TransferStart: {
                    if (this.#transferMeta.has(key) || message.payload.byteLength > 4096) {throw new Error("Invalid start")}
                    const meta = JSON.parse(new TextDecoder().decode(message.payload))
                    if (meta === null || typeof meta !== "object" ||
                        !Number.isSafeInteger(meta.totalChunks) || meta.totalChunks < 1 || meta.totalChunks > MAX_TRANSFER_CHUNKS ||
                        !Number.isSafeInteger(meta.zipSize) || meta.zipSize < meta.totalChunks || meta.zipSize > MAX_TRANSFER_BYTES ||
                        meta.zipSize > meta.totalChunks * ChunkProtocol.CHUNK_SIZE) {throw new Error("Invalid metadata")}
                    this.#transferMeta.set(key, {totalChunks: meta.totalChunks, zipSize: meta.zipSize, received: 0})
                    this.#incomingChunks.set(key, new Map())
                    break
                }
                case ChunkProtocol.MsgType.ChunkData: {
                    const chunks = this.#incomingChunks.get(key)
                    const meta = this.#transferMeta.get(key)
                    if (!chunks || !meta || message.chunkNum >= meta.totalChunks || message.payload.byteLength < 1 ||
                        message.payload.byteLength > ChunkProtocol.CHUNK_SIZE) {throw new Error("Invalid chunk")}
                    const old = chunks.get(message.chunkNum)
                    if (old) {
                        if (old.length !== message.payload.length || old.some((byte, i) => byte !== message.payload[i])) {throw new Error("Conflicting chunk")}
                        break
                    }
                    if (message.payload.byteLength > meta.zipSize - meta.received) {throw new Error("Transfer byte limit")}
                    meta.received += message.payload.byteLength
                    chunks.set(message.chunkNum, message.payload)
                    pending.progress(chunks.size / meta.totalChunks)
                    break
                }
                case ChunkProtocol.MsgType.TransferComplete: {
                    const chunks = this.#incomingChunks.get(key)
                    const meta = this.#transferMeta.get(key)
                    if (!chunks || !meta || chunks.size !== meta.totalChunks || meta.received !== meta.zipSize) {throw new Error("Incomplete transfer")}
                    const ordered: Uint8Array[] = []
                    for (let index = 0; index < meta.totalChunks; index++) {
                        const chunk = chunks.get(index)
                        if (!chunk) {throw new Error("Missing chunk")}
                        ordered.push(chunk)
                    }
                    const zip = ChunkProtocol.reassemble(ordered)
                    if (pending.stallTimer !== null) {clearTimeout(pending.stallTimer)}
                    this.#pendingRequests.delete(key)
                    this.#clearTransferState(key)
                    pending.resolve(zip)
                    return
                }
            }
            this.#resetStallTimer(pending)
        } catch {
            this.#failTransfer(pending)
        }
    }

    async #onRtcAnswer(message: SignalingMessage): Promise<void> {
        if (message.targetPeerId !== this.#localPeerId) {return}
        const peerId = message.peerId as string
        const sdp = message.sdp as string
        const connection = this.#connections.get(peerId)
        if (connection === undefined) {
            console.debug("[P2P:Provider] no connection for rtc-answer from", peerId)
            return
        }
        console.debug("[P2P:Provider] handling rtc-answer from", peerId)
        await connection.handleAnswer(sdp)
    }

    async #onIceCandidate(message: SignalingMessage): Promise<void> {
        const peerId = message.peerId as string
        if (message.targetPeerId !== this.#localPeerId) {return}
        const connection = this.#connections.get(peerId)
        if (connection === undefined) {return}
        await connection.handleIceCandidate(message.candidate as RTCIceCandidateInit)
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#subscription.terminate()
        console.debug("[P2P:Provider] terminating")
        for (const pending of this.#pendingRequests.values()) {
            if (pending.stallTimer !== null) {
                clearTimeout(pending.stallTimer)
            }
            pending.reject(new Error("P2P session terminated"))
        }
        for (const connection of this.#connections.values()) {
            connection.terminate()
        }
        this.#connections.clear()
        this.#pendingRequests.clear()
        this.#incomingChunks.clear()
        this.#transferMeta.clear()
        this.#transferringAssets.clear()
        this.#activePeerTransfers.clear()
        this.#peerQueues.clear()
    }
}
