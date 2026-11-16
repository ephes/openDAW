import {int, Observer, Option, Provider, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {Processor, ProcessPhase} from "./processing"
import {LiveStreamBroadcaster} from "@opendaw/lib-fusion"
import {UpdateClock} from "./UpdateClock"
import {TimeInfo} from "./TimeInfo"
import {AudioUnit} from "./AudioUnit"
import {Mixer} from "./Mixer"
import {BoxAdaptersContext, EngineSettings, EngineToClient, PreferencesClient} from "@opendaw/studio-adapters"
import {AudioOutputBufferRegistry} from "./AudioOutputBufferRegistry"

export interface EngineContext extends BoxAdaptersContext, Terminable {
    get broadcaster(): LiveStreamBroadcaster
    get updateClock(): UpdateClock
    get timeInfo(): TimeInfo
    get mixer(): Mixer
    get engineToClient(): EngineToClient
    get audioOutputBufferRegistry(): AudioOutputBufferRegistry
    get preferences(): PreferencesClient<EngineSettings>
    get baseFrequency(): number

    getAudioUnit(uuid: UUID.Bytes): AudioUnit
    registerProcessor(processor: Processor): Terminable
    registerEdge(source: Processor, target: Processor): Terminable
    // Releases processors and edges registered by `create` if it throws.
    constructAtomically<T>(create: Provider<T>): T
    subscribeProcessPhase(observer: Observer<ProcessPhase>): Subscription
    awaitResource(promise: Promise<unknown>): void
    ignoresRegion(uuid: UUID.Bytes): boolean
    sendMIDIData(midiDeviceId: string, data: Uint8Array, relativeTimeInMs: number): void
    getMonitoringChannel(channelIndex: int): Option<Float32Array>
}