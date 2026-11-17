import css from "./SampleUploadPage.sass?inline"
import {createElement, PageContext, PageFactory} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService.ts"
import {Files, Html} from "@opendaw/lib-dom"
import {Dialogs} from "@/ui/components/dialogs.tsx"
import {estimateBpm, WavFile} from "@opendaw/lib-dsp"
import {FilePickerAcceptTypes, OpenSampleAPI} from "@opendaw/studio-core"

import {decodeSampleUpload} from "./SampleUpload"

const className = Html.adoptStyleSheet(css, "SampleUploadPage")

export const SampleUploadPage: PageFactory<StudioService> = ({service, lifecycle}: PageContext<StudioService>) => {
    let retired = false
    let attempt: AbortController | undefined
    lifecycle.own({terminate: () => {retired = true; attempt?.abort()}})
    return (
        <div className={className}>
            <h1>Upload Sample</h1>
            <div>
                <button onclick={async (event: MouseEvent) => {
                    if (retired || attempt !== undefined) {return}
                    const controller = new AbortController()
                    attempt = controller
                    const button = event.currentTarget as HTMLButtonElement
                    button.disabled = true
                    const isCurrent = () => !retired && !controller.signal.aborted
                    let publishing = false
                    try {
                        const [file] = await Files.open(FilePickerAcceptTypes.WavFiles)
                        if (!isCurrent() || !file) {return}
                        const buffer = await decodeSampleUpload(file, service.audioContext, isCurrent)
                        const name = file.name.substring(0, file.name.lastIndexOf(".wav"))
                        const sample_rate = buffer.sampleRate
                        const duration = buffer.duration
                        const bpm = estimateBpm(duration)
                        const wav = WavFile.encodeFloats(buffer)
                        console.debug("name", name)
                        console.debug("sampleRate", sample_rate)
                        console.debug("duration", duration)
                        console.debug("bpm", bpm)
                        if (!isCurrent()) {return}
                        publishing = true
                        await OpenSampleAPI.get().upload(wav, {name, bpm, sample_rate, duration, origin: "openDAW"}, controller.signal)
                    } catch (error) {
                        if (!isCurrent()) {return}
                        if (error instanceof DOMException && error.name === "AbortError") {
                            console.debug("Caught an AbortError")
                        } else {
                            void Dialogs.info({message: publishing
                                ? "Upload outcome is uncertain. Check the sample catalog before trying again."
                                : String(error)}).catch(() => {})
                        }
                    } finally {
                        if (attempt === controller) {attempt = undefined}
                        if (!retired) {button.disabled = false}
                    }
                }}>
                    Browse
                </button>
            </div>
        </div>
    )
}