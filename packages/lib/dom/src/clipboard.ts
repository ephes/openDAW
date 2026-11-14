import {RuntimeNotifier} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"

export namespace Clipboard {
    export const writeText = async (text: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text)
        } catch (reason) {
            try {
                await RuntimeNotifier.info({
                    headline: "Clipboard Error",
                    message: "Could not write to clipboard. Please check your browser permissions."
                })
            } catch {
                // Notification failure must not replace the clipboard failure.
            }
            throw reason
        }
    }
    export const readText = async (): Promise<string> => {
        const result = await Promises.tryCatch(navigator.clipboard.readText())
        if (result.status === "resolved") {return result.value}
        await RuntimeNotifier.info({
            headline: "Clipboard Error",
            message: "Could not read from clipboard. Please check your browser permissions."
        })
        return ""
    }
}
