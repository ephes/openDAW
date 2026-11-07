/** @deprecated Cancellation now preserves AbortSignal.reason; compare to the caller's signal.reason instead. */
export class InferenceCancelledError extends Error {
    constructor(message: string = "Inference cancelled") {
        super(message)
        this.name = "InferenceCancelledError"
    }
}

export class InferenceEngineError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "InferenceEngineError"
    }
}
