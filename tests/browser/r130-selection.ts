import {selectToneUrl} from "@/ui/devices/audio-effects/NeuralAmp/ToneSelection"

export const setup = () => {
    const selections: Array<{index: number, value: string}> = []
    const controllers = [new AbortController(), new AbortController()]
    const pending = controllers.map((controller, index) => selectToneUrl(controller.signal)
        .then(value => {selections.push({index, value})}, () => {}))
    return {selections, pending, retire: () => controllers.forEach(controller => controller.abort())}
}
