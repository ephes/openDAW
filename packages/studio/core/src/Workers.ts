import {assert, FloatArray, int, Lazy, Option, Procedure} from "@opendaw/lib-std"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import type {OpfsProtocol, SamplePeakProtocol} from "@opendaw/lib-fusion"
import type {AudioData, TransientProtocol} from "@opendaw/lib-dsp"

export class Workers {
    static #initializing: boolean = false

    static async install(url: string): Promise<void> {
        assert(this.messenger.isEmpty() && !this.#initializing, "Workers are already installed or initializing")
        this.#initializing = true
        let worker: Worker | undefined
        let message: Messenger | undefined
        try {
            worker = new Worker(url, {type: "module"})
            message = Messenger.for(worker)
            const attempt = worker
            const initialize = message.channel("initialize")
            await new Promise<void>((resolve, reject) => {
                let settled = false
                const finish = (error?: Error) => {
                    if (settled) {return}
                    settled = true
                    clearTimeout(timer)
                    attempt.onerror = null
                    attempt.onmessageerror = null
                    initialize.terminate()
                    if (error === undefined) {resolve()} else {reject(error)}
                }
                const timer = setTimeout(() => finish(new Error("Workers initialization timed out")), 10000)
                attempt.onerror = () => finish(new Error("Workers initialization failed"))
                attempt.onmessageerror = () => finish(new Error("Workers initialization message error"))
                initialize.subscribe(data => {if (data === "ready") {finish()}})
            })
            this.messenger = Option.wrap(message)
        } catch (error) {
            message?.terminate()
            worker?.terminate()
            throw error
        } finally {
            this.#initializing = false
        }
    }

    static messenger: Option<Messenger> = Option.None

    @Lazy
    static get Peak(): SamplePeakProtocol {
        return Communicator
            .sender<SamplePeakProtocol>(this.messenger.unwrap("Workers are not installed").channel("peaks"),
                router => new class implements SamplePeakProtocol {
                    async generateAsync(
                        progress: Procedure<number>,
                        shifts: Uint8Array,
                        frames: ReadonlyArray<FloatArray>,
                        numFrames: int,
                        numChannels: int): Promise<ArrayBufferLike> {
                        return router.dispatchAndReturn(this.generateAsync, progress, shifts, frames, numFrames, numChannels)
                    }
                })
    }

    @Lazy
    static get Opfs(): OpfsProtocol {
        return Communicator
            .sender<OpfsProtocol>(this.messenger.unwrap("Workers are not installed").channel("opfs"),
                router => new class implements OpfsProtocol {
                    write(path: string, data: Uint8Array): Promise<void> {return router.dispatchAndReturn(this.write, path, data)}
                    read(path: string): Promise<Uint8Array> {return router.dispatchAndReturn(this.read, path)}
                    exists(path: string): Promise<boolean> {return router.dispatchAndReturn(this.exists, path)}
                    delete(path: string): Promise<void> {return router.dispatchAndReturn(this.delete, path)}
                    list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>> {return router.dispatchAndReturn(this.list, path)}
                })
    }

    @Lazy
    static get Transients(): TransientProtocol {
        return Communicator
            .sender<TransientProtocol>(this.messenger.unwrap("Workers are not installed").channel("transients"),
                router => new class implements TransientProtocol {
                    detect(audioData: AudioData): Promise<Array<number>> {return router.dispatchAndReturn(this.detect, audioData)}
                })
    }
}