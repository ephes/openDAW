import {byte, ByteArrayInput, int, Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioFileBox, PlayfieldDeviceBox, PlayfieldSampleBox} from "@opendaw/studio-boxes"
import {Project} from "@opendaw/studio-core"
import {DragAndDrop} from "@/ui/DragAndDrop"
import {AnyDragData, DragDevice} from "@/ui/AnyDragData"
import {PlayfieldSampleBoxAdapter} from "@opendaw/studio-adapters"

export namespace SlotDragAndDrop {
    const findSampleByIndex = (device: PlayfieldDeviceBox, index: int): Option<PlayfieldSampleBox> =>
        Option.wrap(device.samples.pointerHub.incoming().map(({box}) => box)
            .find(box => box instanceof PlayfieldSampleBox && box.index.getValue() === index) as PlayfieldSampleBox | undefined)

    const executeCopy = (project: Project, sourceBox: PlayfieldSampleBox, device: PlayfieldDeviceBox, targetIndex: int): void => {
        const sourceIndex = sourceBox.index.getValue()
        if (sourceIndex === targetIndex) {return}
        const {editing, boxGraph} = project
        const file = sourceBox.file.targetVertex.unwrapOrNull()?.box
        if (!(file instanceof AudioFileBox) || !file.isAttached()
            || sourceBox.device.targetVertex.unwrapOrNull() !== device.samples) {return}
        const contents = sourceBox.toArrayBuffer()
        const target = findSampleByIndex(device, targetIndex)
        editing.modify(() => {
            target.ifSome(box => box.delete())
            PlayfieldSampleBox.create(boxGraph, UUID.generate(), box => {
                box.read(new ByteArrayInput(contents))
                box.file.refer(file)
                box.device.refer(device.samples)
                box.index.setValue(targetIndex)
            })
        })
    }

    const executeSwap = (project: Project, sourceBox: PlayfieldSampleBox, device: PlayfieldDeviceBox, targetIndex: int): void => {
        const sourceIndex = sourceBox.index.getValue()
        if (sourceIndex === targetIndex) {return}
        const {editing} = project
        const target = findSampleByIndex(device, targetIndex)
        editing.modify(() => {
            sourceBox.index.setValue(targetIndex)
            target.ifSome(box => box.index.setValue(sourceIndex))
        })
    }

    type SourceConstruct = {
        element: HTMLElement
        sample: PlayfieldSampleBoxAdapter
        getSlotIndex: () => int
    }

    export const installSource = ({element, sample, getSlotIndex}: SourceConstruct): Terminable => {
        return DragAndDrop.installSource(element, () => ({
            type: "playfield-slot",
            index: getSlotIndex() as byte,
            uuid: UUID.toString(sample.address.uuid)
        } satisfies DragDevice))
    }

    type TargetConstruct = {
        element: HTMLElement
        project: Project
        device: PlayfieldDeviceBox
        getSlotIndex: () => int
    }

    export const installTarget = ({element, project, device, getSlotIndex}: TargetConstruct): Terminable => {
        return DragAndDrop.installTarget(element, {
            drag: (_event: DragEvent, data: AnyDragData): boolean => {
                return data.type === "playfield-slot" && data.index !== getSlotIndex()
            },
            drop: (event: DragEvent, data: AnyDragData): void => {
                if (data.type !== "playfield-slot" || !UUID.validateString(data.uuid)) {return}
                const source = project.boxGraph.findBox(UUID.parse(data.uuid)).unwrapOrNull()
                if (!(source instanceof PlayfieldSampleBox)
                    || project.boxGraph.findBox(device.address.uuid).unwrapOrNull() !== device
                    || source.index.getValue() !== data.index
                    || source.device.targetVertex.unwrapOrNull() !== device.samples) {return}
                const targetIndex = getSlotIndex()
                if (event.altKey) {
                    executeCopy(project, source, device, targetIndex)
                } else {
                    executeSwap(project, source, device, targetIndex)
                }
            },
            enter: (allowDrop: boolean) => element.classList.toggle("drop-target", allowDrop),
            leave: () => element.classList.remove("drop-target")
        })
    }
}
