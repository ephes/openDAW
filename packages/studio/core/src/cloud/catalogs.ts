import {z} from "zod"
import {UUID} from "@opendaw/lib-std"
import {InstrumentFactories, Sample, Soundfont} from "@opendaw/studio-adapters"
import type {EffectFactories} from "../EffectFactories"

const uuid = z.string().refine(UUID.validateString)
const date = z.string().refine(value => Number.isFinite(Date.parse(value)))
const project = z.object({
    name: z.string(), description: z.string(), tags: z.array(z.string()),
    created: date, modified: date
}).passthrough()
const presetCommon = z.object({
    uuid, name: z.string(), description: z.string(),
    created: z.number(), modified: z.number(), hasTimeline: z.boolean().optional()
}).passthrough()
const instrument = z.custom<InstrumentFactories.Keys>(value => typeof value === "string" && value.length > 0)
const audioEffect = z.custom<EffectFactories.AudioEffectKeys>(value => typeof value === "string" && value.length > 0)
const midiEffect = z.custom<EffectFactories.MidiEffectKeys>(value => typeof value === "string" && value.length > 0)
const preset = z.discriminatedUnion("category", [
    presetCommon.extend({category: z.literal("instrument"), device: instrument}),
    presetCommon.extend({category: z.literal("audio-effect"), device: audioEffect}),
    presetCommon.extend({category: z.literal("midi-effect"), device: midiEffect}),
    presetCommon.extend({category: z.literal("audio-unit"), instrument}),
    presetCommon.extend({category: z.literal("audio-effect-chain")}),
    presetCommon.extend({category: z.literal("midi-effect-chain")})
])
const uniqueIds = (entries: ReadonlyArray<{uuid: string}>) =>
    new Set(entries.map(entry => entry.uuid.toLowerCase())).size === entries.length
const samples = z.array(Sample.passthrough()).refine(uniqueIds)
const soundfonts = z.array(Soundfont.passthrough()).refine(uniqueIds)
const presets = z.array(preset).refine(uniqueIds)
const projects = z.record(uuid, project).refine(value => {
    const keys = Object.keys(value).map(key => key.toLowerCase())
    return new Set(keys).size === keys.length
})

const validate = <T>(schema: z.ZodType<T>, value: unknown, domain: string, source: string): T => {
    try {return schema.parse(value)} catch (cause) {
        throw new Error(`Invalid ${source} catalog (${domain}); repair it before backup.`, {cause})
    }
}
const decode = (bytes: ArrayBuffer, domain: string): unknown => {
    try {return JSON.parse(new TextDecoder().decode(bytes))} catch (cause) {
        throw new Error(`Invalid cloud catalog (${domain}); repair it before backup.`, {cause})
    }
}
// Nonempty device keys remain opaque for forward-compatible catalog transport.
export const validateSamplesCatalog = (value: unknown, source = "local") => validate(samples, value, "samples", source)
export const validateSoundfontsCatalog = (value: unknown, source = "local") => validate(soundfonts, value, "soundfonts", source)
export const validatePresetsCatalog = (value: unknown, source = "local") => validate(presets, value, "presets", source)
export const validateProjectsCatalog = (value: unknown, source = "local") => validate(projects, value, "projects", source)
export const parseSamplesCatalog = (bytes: ArrayBuffer) => validateSamplesCatalog(decode(bytes, "samples"), "cloud")
export const parseSoundfontsCatalog = (bytes: ArrayBuffer) => validateSoundfontsCatalog(decode(bytes, "soundfonts"), "cloud")
export const parsePresetsCatalog = (bytes: ArrayBuffer) => validatePresetsCatalog(decode(bytes, "presets"), "cloud")
export const parseProjectsCatalog = (bytes: ArrayBuffer) => validateProjectsCatalog(decode(bytes, "projects"), "cloud")
