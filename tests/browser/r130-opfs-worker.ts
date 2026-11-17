import {OpfsWorker} from "@opendaw/lib-fusion"
import {Messenger, Port} from "@opendaw/lib-runtime"
const messenger = Messenger.for(self as unknown as Port)
OpfsWorker.init(messenger)
messenger.channel("initialize").send("ready")
