import {describe, expect, it} from "vitest"
import {Xml} from "./index"

@Xml.Class("Scalars")
class Scalars {
    @Xml.Attribute("number", Xml.NumberRequired)
    readonly number!: number
    @Xml.Attribute("optionalNumber", Xml.NumberOptional)
    readonly optionalNumber?: number
    @Xml.Attribute("boolean", Xml.BoolRequired)
    readonly boolean!: boolean
    @Xml.Attribute("optionalBoolean", Xml.BoolOptional)
    readonly optionalBoolean?: boolean
}

@Xml.Class("Optional")
class Optional {
    @Xml.Attribute("number", Xml.NumberOptional)
    readonly number?: number
}

@Xml.Class("Derived")
class Derived extends Optional {}

describe("XML import contracts", () => {
    it.each(["", "<Optional>", "<Optional><Broken></Optional>"])("rejects malformed XML %j", text => {
        expect(() => Xml.parse(text, Optional)).toThrow("Invalid XML document")
    })

    it("rejects a wrong root even when every schema field is optional", () => {
        expect(() => Xml.parse('<Other number="junk"/>', Optional)).toThrow("Expected XML root 'Optional'")
    })

    it("accepts declarations, whitespace, default namespaces and ordinary parsererror children", () => {
        const value = Xml.parse(` \n${Xml.Declaration}\n<Optional xmlns="urn:example" number="0"><parsererror>ordinary data</parsererror></Optional>`, Optional)
        expect(value.number).toBe(0)
    })

    it.each([
        "http://www.mozilla.org/newlayout/xml/parsererror.xml",
        "http://www.w3.org/1999/xhtml"
    ])("rejects embedded parser diagnostics in %s", namespace => {
        expect(() => Xml.parse(`<Optional><parsererror xmlns="${namespace}">diagnostic</parsererror></Optional>`, Optional))
            .toThrow("Invalid XML document")
    })

    it("uses the requested derived class tag rather than its decorated ancestor", () => {
        expect(Xml.parse('<Derived number="2"/>', Derived).number).toBe(2)
        expect(() => Xml.parse('<Optional number="2"/>', Derived)).toThrow("Expected XML root 'Derived'")
    })

    it.each(["Infinity", "-Infinity", "1e999", "NaN", "junk", "", "   "])("rejects invalid numeric attributes %j", value => {
        expect(() => Xml.parse(`<Scalars number="${value}" boolean="true"/>`, Scalars)).toThrow("Invalid XML attribute 'number'")
        expect(() => Xml.parse(`<Scalars number="0" optionalNumber="${value}" boolean="true"/>`, Scalars)).toThrow("Invalid XML attribute 'optionalNumber'")
    })

    it.each([0, -1.5, 1250])("round-trips finite number %s with boolean values", number => {
        const value = Xml.element({number, boolean: false, optionalNumber: 0, optionalBoolean: true}, Scalars)
        const xml = Xml.pretty(Xml.toElement("Scalars", value))
        const result = Xml.parse(xml, Scalars)
        expect(result).toEqual(value)
    })

    it.each([
        ["1.5e3", 1500], ["-2.5e-1", -0.25],
        ["0x10", 16], ["0b101", 5], ["0o7", 7]
    ] as const)("retains finite Number() format %j", (literal, expected) => {
        const result = Xml.parse(`<Scalars number="${literal}" optionalNumber="${literal}" boolean="true"/>`, Scalars)
        expect(result.number).toBe(expected)
        expect(result.optionalNumber).toBe(expected)
    })

    it("keeps absent optional attributes absent", () => {
        const result = Xml.parse('<Scalars number="0" boolean="true"/>', Scalars)
        expect(result.optionalNumber).toBeUndefined()
        expect(result.optionalBoolean).toBeUndefined()
    })

    it.each([["true", true], ["false", false], ["1", true], ["0", false], ["TRUE", true], [" FALSE ", false]] as const)("accepts boolean literal %j", (literal, expected) => {
        const result = Xml.parse(`<Scalars number="0" boolean="${literal}" optionalBoolean="${literal}"/>`, Scalars)
        expect(result.boolean).toBe(expected)
        expect(result.optionalBoolean).toBe(expected)
    })

    it.each(["junk", "yes", "2", "-1", "", "   "])("rejects invalid boolean literal %j", literal => {
        expect(() => Xml.parse(`<Scalars number="0" boolean="${literal}"/>`, Scalars)).toThrow("Invalid XML attribute 'boolean'")
        expect(() => Xml.parse(`<Scalars number="0" boolean="true" optionalBoolean="${literal}"/>`, Scalars)).toThrow("Invalid XML attribute 'optionalBoolean'")
    })

    it.each([Xml.NumberRequired, Xml.NumberOptional])("rejects nonfinite programmatic numbers", validator => {
        for (const value of [Infinity, -Infinity, NaN]) {
            expect(() => validator.parse(value)).toThrow()
        }
    })
})
