import {Promises} from "@opendaw/lib-runtime"
import {Arrays, Errors, Optional} from "@opendaw/lib-std"

export class AudioDevices {
    static async requestPermission() {
        const {status, value: stream} =
            await Promises.tryCatch(navigator.mediaDevices.getUserMedia({audio: true}))
        if (status === "rejected") {return Errors.warn("Could not request permission.")}
        stream.getTracks().forEach(track => track.stop())
        await this.updateInputList()
    }

    static async requestStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
        const {status, value: stream, error} =
            await Promises.tryCatch(navigator.mediaDevices.getUserMedia({audio: constraints}))
        if (status === "rejected") {
            return Errors.warn(Errors.isOverconstrained(error)
                ? "Audio input constraints could not be satisfied"
                : Errors.isNotAllowed(error) ? "Audio input permission denied" : "Audio input unavailable")
        }
        try {
            await this.updateInputList()
            return stream
        } catch (error) {
            // Ownership transfers only when setup returns the stream.
            for (const track of stream.getTracks()) {
                try {track.stop()} catch { /* Release the other attempt-owned tracks too. */ }
            }
            throw error
        }
    }

    static async updateInputList() {
        const generation = ++this.#inputGeneration
        const {status, value: devices} = await Promises.tryCatch(navigator.mediaDevices.enumerateDevices())
        if (generation !== this.#inputGeneration) {return}
        if (status === "rejected") {
            return Errors.warn("Could not enumerate devices.")
        }
        this.#inputs = devices.filter(device =>
            device.kind === "audioinput" && device.deviceId !== "" && device.groupId !== "")
    }

    static #inputGeneration = 0
    static #inputs: ReadonlyArray<MediaDeviceInfo> = Arrays.empty()

    static get inputs(): ReadonlyArray<MediaDeviceInfo> {return this.#inputs}

    static get defaultInput(): Optional<MediaDeviceInfo> {
        return this.#inputs.find(device => device.deviceId === "default") ?? this.#inputs.at(0)
    }
}