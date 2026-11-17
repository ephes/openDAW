import {expect, it} from "vitest"
import {Xml} from "@opendaw/lib-xml"
import {ArrangementSchema, MarkersSchema} from "./defaults"

it('parses marker collections as typed numeric elements and round-trips the container', () => {
    const arrangement = Xml.parse('<Arrangement><Markers timeUnit="beats"><Marker time="2" name="Verse"/><Marker time="4.5" name="Chorus" color="#33ff33"/></Markers></Arrangement>', ArrangementSchema)
    const markers = arrangement.markers as MarkersSchema
    expect(markers.marker.map(marker => [marker.time, marker.name])).toEqual([[2, 'Verse'], [4.5, 'Chorus']])
    expect(markers.timeUnit).toBe('beats')
    const reopened = Xml.parse(Xml.pretty(Xml.toElement('Arrangement', arrangement)), ArrangementSchema)
    expect(reopened).toEqual(arrangement)
})
it('retains an empty marker collection', () => {
    expect(Xml.parse('<Markers/>', MarkersSchema).marker).toEqual([])
})
