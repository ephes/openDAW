import {z} from "zod"
import {UUID} from "@opendaw/lib-std"
import {InstrumentFactories} from "@opendaw/studio-adapters"
import {EffectFactories} from "../EffectFactories"

type PresetCommon = {
    uuid: UUID.String
    name: string
    description: string
    created: number
    modified: number
    hasTimeline?: boolean
}

export type InstrumentPresetMeta = PresetCommon & {
    category: "instrument"
    device: InstrumentFactories.Keys
}

export type AudioEffectPresetMeta = PresetCommon & {
    category: "audio-effect"
    device: EffectFactories.AudioEffectKeys
}

export type MidiEffectPresetMeta = PresetCommon & {
    category: "midi-effect"
    device: EffectFactories.MidiEffectKeys
}

export type RackPresetMeta = PresetCommon & {
    category: "audio-unit"
    instrument: InstrumentFactories.Keys
}

export type AudioEffectChainPresetMeta = PresetCommon & {
    category: "audio-effect-chain"
}

export type MidiEffectChainPresetMeta = PresetCommon & {
    category: "midi-effect-chain"
}

export type PresetMeta =
    | InstrumentPresetMeta
    | AudioEffectPresetMeta
    | MidiEffectPresetMeta
    | RackPresetMeta
    | AudioEffectChainPresetMeta
    | MidiEffectChainPresetMeta

export type PresetCategory = PresetMeta["category"]

export type PresetSource = "stock" | "user"

export type PresetEntry = PresetMeta & {source: PresetSource}

const CommonPresetSchema = z.object({
    uuid: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    name: z.string(), description: z.string(), created: z.number().finite(), modified: z.number().finite(),
    hasTimeline: z.boolean().optional()
})
const instrumentKey = z.string().refine(key => Object.hasOwn(InstrumentFactories.Named, key))
export const PresetMetaSchema = z.discriminatedUnion("category", [
    CommonPresetSchema.extend({category: z.literal("instrument"), device: instrumentKey}),
    CommonPresetSchema.extend({category: z.literal("audio-effect"), device: z.string().refine(key => Object.hasOwn(EffectFactories.AudioNamed, key))}),
    CommonPresetSchema.extend({category: z.literal("midi-effect"), device: z.string().refine(key => Object.hasOwn(EffectFactories.MidiNamed, key))}),
    CommonPresetSchema.extend({category: z.literal("audio-unit"), instrument: instrumentKey}),
    CommonPresetSchema.extend({category: z.literal("audio-effect-chain")}),
    CommonPresetSchema.extend({category: z.literal("midi-effect-chain")})
])
