import {expect, it} from "vitest"
import {Xml} from "@opendaw/lib-xml"
import {PointsSchema} from "./defaults"

const points = ['Point', 'RealPoint value="120"', 'IntegerPoint value="1"', 'BoolPoint value="true"', 'TimeSignaturePoint numerator="3" denominator="4"']
for (const point of points) {
    it.each(['', 'time=""', 'time="garbage"', 'time="NaN"', 'time="Infinity"', 'time="1e400"'])(`requires a finite time for ${point}: %s`, time => {
        expect(() => Xml.parse(`<Points><${point} ${time}/></Points>`, PointsSchema)).toThrow(/time/)
    })
    it(`converts zero and fractional time for ${point}`, () => {
        const parsed = Xml.parse(`<Points><${point} time="0"/><${point} time="0.5"/></Points>`, PointsSchema)
        expect(parsed.points!.map(point => point.time)).toEqual([0, 0.5])
    })
}
