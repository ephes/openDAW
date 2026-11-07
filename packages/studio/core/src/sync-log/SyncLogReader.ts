import {assert, ByteArrayInput, Hash, int} from "@opendaw/lib-std"
import {Updates} from "@opendaw/lib-box"
import {Wait} from "@opendaw/lib-runtime"
import {Project} from "../project/Project"
import {Commit, CommitType} from "./Commit"
import {ProjectEnv} from "../project/ProjectEnv"

export class SyncLogReader {
    static async unwrap(env: ProjectEnv, buffer: ArrayBuffer, options: {allowLegacy?: boolean} = {}): Promise<{
        project: Project,
        lastCommit: Commit,
        numCommits: int
    }> {
        console.debug("SyncLogReader.unwrapping begin")
        const input = new ByteArrayInput(buffer)
        const commits: Commit[] = []
        while (input.remaining() > 0) {
            const commit = Commit.deserialize(input)
            await commit.verify(options.allowLegacy)
            const previous = commits.at(-1)
            if (previous !== undefined) {assert(Hash.equals(previous.thisHash, commit.prevHash), "SyncLog inconsistency")}
            commits.push(commit)
        }
        assert(commits.length > 0, "Sync log contains no commits")
        const firstCommit = commits[0]
        assert(firstCommit.type === CommitType.Init, "First commit must be typed with CommitType.Init")
        const project = Project.load(env, firstCommit.payload)
        const {boxGraph} = project
        let prevCommit: Commit = firstCommit
        let lastFrame = Date.now()
        const numCommits = commits.length
        for (const nextCommit of commits.slice(1)) {
            // We have not implemented any other types, so let's accept only updates
            if (nextCommit.type === CommitType.Open) {
                console.debug("Opened at", new Date(nextCommit.date).toISOString())
            } else if (nextCommit.type === CommitType.Updates) {
                const updates = Updates.decode(new ByteArrayInput(nextCommit.payload))
                boxGraph.beginTransaction()
                updates.forEach(update => update.forward(boxGraph))
                boxGraph.endTransaction()
            }
            prevCommit = nextCommit
            const now = Date.now()
            if (now - lastFrame > 16) {
                console.debug("Pause unwrapping to allow browser to render a frame.")
                await Wait.frame()
                lastFrame = now
            }
        }
        console.debug("SyncLogReader.unwrapping complete")
        return Promise.resolve({project, lastCommit: prevCommit, numCommits})
    }
}