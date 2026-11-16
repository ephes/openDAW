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
        const source = Option.wrap(sourceBox)
        const target = findSampleByIndex(device, targetIndex)
        source.ifSome(sourceBox => {
            editing.modify(() => {
                // If target has a sample, delete it first
                target.ifSome(targetBox => targetBox.delete())
                // Get the source file (AudioFileBox)
                const sourceFile = sourceBox.file.targetVertex
                    .map(vertex => vertex.box instanceof AudioFileBox ? vertex.box : null)
                // Get the device box and its samples hub
                const deviceBox = sourceBox.device.targetVertex
                    .map(vertex => vertex.box instanceof PlayfieldDeviceBox ? vertex.box : null)
                if (sourceFile.nonEmpty() && deviceBox.nonEmpty()) {
                    PlayfieldSampleBox.create(boxGraph, UUID.generate(), box => {
                        box.read(new ByteArrayInput(sourceBox.toArrayBuffer()))
                        box.file.refer(sourceFile.unwrap())
                        box.device.refer(deviceBox.unwrap().samples)
                        box.index.setValue(targetIndex)
                    })
                }
            })
        })
    }

    const executeSwap = (project: Project, sourceBox: PlayfieldSampleBox, device: PlayfieldDeviceBox, targetIndex: int): void => {
        const sourceIndex = sourceBox.index.getValue()
        if (sourceIndex === targetIndex) {return}
        const {editing} = project
        const source = Option.wrap(sourceBox)
        const target = findSampleByIndex(device, targetIndex)
        editing.modify(() => {
            if (source.nonEmpty() && target.isEmpty()) {
                source.unwrap().index.setValue(targetIndex)
            } else if (source.isEmpty() && target.nonEmpty()) {
                target.unwrap().index.setValue(sourceIndex)
            } else if (source.nonEmpty() && target.nonEmpty()) {
                source.unwrap().index.setValue(targetIndex)
                target.unwrap().index.setValue(sourceIndex)
            }
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
            uuid: sample.address.uuid.toString()
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
                if (data.type !== "playfield-slot") {return}
                const source = project.boxGraph.findBox(UUID.parse(data.uuid)).unwrapOrNull()
                if (!(source instanceof PlayfieldSampleBox) || !device.isAttached()
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
