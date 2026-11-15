import {Func, isDefined, Observer, Option, RuntimeNotifier, Subscription, Terminable} from "@opendaw/lib-std"
import {BoxGraph, Update} from "@opendaw/lib-box"
import {Project} from "../project/Project"
import {Commit} from "./Commit"

export class SyncLogWriter implements Terminable {
    static attach(project: Project, observer: Observer<Commit>, lastCommit?: Commit): SyncLogWriter {
        console.debug("SyncLogWriter.attach", project.rootBox.created.getValue(), isDefined(lastCommit) ? "append" : "new")
        return project.own(new SyncLogWriter(project, observer, lastCommit))
    }

    readonly #observer: Observer<Commit>
    readonly #subscription: Subscription
    #transactionSubscription: Subscription = Terminable.Empty
    #updates: Array<Update> = []
    #lastPromise: Promise<Commit | undefined>
    #error: Option<unknown> = Option.None
    #terminated = false

    get error(): Option<unknown> {return this.#error}

    private constructor(project: Project, observer: Observer<Commit>, lastCommit?: Commit) {
        this.#observer = observer
        // Capture the initial graph now; later edits belong to update commits.
        let initial: Promise<Commit>
        try {initial = Promise.resolve(lastCommit ?? Commit.createFirst(project))}
        catch (error) {initial = Promise.reject(error)}
        this.#lastPromise = initial.then(async commit => {
            if (!isDefined(lastCommit)) {await this.#observer(commit)}
            return commit
        }).catch(error => this.#fail(error))
        this.#appendCommit(previous => Commit.createOpen(previous.thisHash))
        this.#subscription = this.#listen(project.boxGraph)
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#updates = []
        Terminable.many(this.#subscription, this.#transactionSubscription).terminate()
        this.#transactionSubscription = Terminable.Empty
    }

    #fail(error: unknown): undefined {
        if (this.#error.nonEmpty()) {return}
        this.#error = Option.wrap(error instanceof Error ? error : new Error("Recovery log write failed", {cause: error}))
        try {this.terminate()} catch {console.warn("Recovery log cleanup failed")} finally {
            void Promise.resolve().then(() => RuntimeNotifier.info({
                headline: "Recovery Log Stopped",
                message: "The recovery log could not be written. Further edits are not being logged. Save your project and start a new recovery log."
            })).catch(() => console.warn("Recovery log failure notification failed"))
        }
    }

    #appendCommit(factory: Func<Commit, Promise<Commit>>): void {
        this.#lastPromise = this.#lastPromise.then(async previous => {
            if (!isDefined(previous) || this.#error.nonEmpty()) {return}
            const commit = await factory(previous)
            await this.#observer(commit)
            return commit
        }).catch(error => this.#fail(error))
    }

    #listen(boxGraph: BoxGraph): Subscription {
        return boxGraph.subscribeTransaction({
            onBeginTransaction: () => {
                if (this.#terminated) {return}
                this.#transactionSubscription = boxGraph.subscribeToAllUpdatesImmediate({
                    onUpdate: (update: Update) => {if (!this.#terminated) {this.#updates.push(update)}}
                })
            },
            onEndTransaction: (rolledBack) => {
                this.#transactionSubscription.terminate()
                this.#transactionSubscription = Terminable.Empty
                const updates = this.#updates
                this.#updates = []
                if (this.#terminated || rolledBack || updates.length === 0) {return}
                this.#appendCommit(previous => Commit.createUpdate(previous.thisHash, updates))
            }
        })
    }
}
