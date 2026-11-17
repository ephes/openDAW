import {Exec, Terminable, Terminator} from "@opendaw/lib-std"
import {AnyRegionBoxAdapter} from "@opendaw/studio-adapters"

/**
 * Watches the region's track pointer once and keeps exactly one listener on its current track.
 * A track change retires the previous track listener before binding the current one; a detached region binds none.
 */
export const listenToRegionTrack = (region: AnyRegionBoxAdapter, onChange: Exec): Terminable => {
    const track = new Terminator()
    let terminated = false
    const bind = (): void => {
        track.terminate()
        region.trackBoxAdapter.ifSome(adapter => track.own(adapter.regions.subscribeChanges(onChange)))
    }
    bind()
    const pointer = region.box.regions.subscribe(() => {
        if (terminated) {return}
        bind()
        onChange()
    })
    return Terminable.create(() => {
        if (terminated) {return}
        terminated = true
        pointer.terminate()
        track.terminate()
    })
}
