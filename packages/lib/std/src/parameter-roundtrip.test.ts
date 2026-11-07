import {expect, it} from "vitest"
import {StringMapping} from "./string-mapping"
import {DefaultParameter} from "./parameters"
import {ValueMapping} from "./value-mapping"
import {DefaultObservableValue, MutableObservableValue} from "./observables"

it("roundtrips boolean parameter text and legacy words", () => {
    const p = new DefaultParameter(ValueMapping.bool, StringMapping.bool, "Mute", true)
    for (const value of [true, false]) {
        p.setValue(value)
        p.setPrintValue(p.getPrintValue().value)
        expect(p.getValue()).toBe(value)
    }
    for (const word of [" ON ", "Yes", "TRUE"]) {expect(StringMapping.bool.y(word)).toEqual({type: "explicit", value: true})}
    for (const word of ["off", "no", "false", "only", "truthy"]) {expect(StringMapping.bool.y(word)).toEqual({type: "explicit", value: false})}
    expect(StringMapping.boolValues("disabled", "enabled").y("On")).toEqual({type: "explicit", value: true})
})
it("roundtrips the symmetry parameter's bipolar percent mapping", () => {
    const p = new DefaultParameter(ValueMapping.unipolar(), StringMapping.percent({fractionDigits: 1, bipolar: true}), "Symmetry", 0.5)
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
        p.setValue(value)
        const {value: text, unit} = p.getPrintValue()
        p.setPrintValue(`${text}${unit}`)
        expect(p.getValue()).toBe(value)
    }
    expect(StringMapping.numeric({bipolar: true}).y("50%")).toEqual({type: "unitValue", value: 0.75})
})
it("parses full signed decimal/exponent values with explicit SI prefixes and units", () => {
    const mapping = StringMapping.numeric({unit: "Hz", unitPrefix: true, fractionDigits: 2})
    for (const [text, value] of [["2.50kHz", 2500], ["-2.50 kHz", -2500], ["1.25MHz", 1250000], ["2.50mHz", 0.0025], ["2.50μHz", 0.0000025], ["+2.5e1kHz", 25000], [".5Hz", 0.5]] as const) {
        const parsed = mapping.y(text)
        expect(parsed.type).toBe("explicit")
        expect(parsed.value).toBeCloseTo(value, 10)
    }
    for (const value of [2500, 1250000, 0.0025, 0.0000025, -2500]) {
        const printed = mapping.x(value)
        const parsed = mapping.y(`${printed.value}${printed.unit}`)
        expect(parsed.type).toBe("explicit")
        expect(parsed.value).toBeCloseTo(value, 10)
    }
    const p = new DefaultParameter(ValueMapping.linear(-10000, 10000), mapping, "Frequency", 2500)
    for (const junk of ["2.5watts", "2.5kHzjunk", "2..5Hz", "2eHz", "Infinity", "1e999Hz", "50%junk"]) {
        p.setPrintValue(junk)
        expect(p.getValue()).toBe(2500)
    }
})
it("notifies inverse owners consistently and releases its subscription", () => {
    const source = new DefaultObservableValue(false)
    const inverse = MutableObservableValue.inverseBoolean(source)
    const values: boolean[] = []
    const subscription = inverse.catchupAndSubscribe(owner => {
        expect(owner).toBe(inverse)
        expect(owner.getValue()).toBe(inverse.getValue())
        values.push(owner.getValue())
    })
    source.setValue(true)
    inverse.setValue(true)
    subscription.terminate()
    source.setValue(true)
    expect(values).toEqual([true, false, true])
})
