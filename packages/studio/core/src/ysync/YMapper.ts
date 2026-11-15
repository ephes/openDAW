import {
    Address,
    ArrayField,
    Box,
    Field,
    Fields,
    ObjectField,
    PointerField,
    PrimitiveField,
    Vertex
} from "@opendaw/lib-box"
import * as Y from "yjs"
import {
    asDefined,
    assert,
    isDefined,
    isInstanceOf,
    isNotUndefined,
    isUndefined,
    JSONValue,
    UUID
} from "@opendaw/lib-std"

export namespace YMapper {
    export const createBoxMap = (box: Box): Y.Map<unknown> => {
        const map = new Y.Map()
        map.set("name", box.name)
        map.set("fields", createDeepMap(box.record()))
        return map
    }

    export const applyFromBoxMap = (box: Box, source: Y.Map<unknown>): void => {
        const apply = (vertex: Vertex, map: Y.Map<unknown>) => {
            const record = vertex.record()
            map.forEach((value, key) => {
                fieldKey(key)
                const field = record[key]
                if (isUndefined(field)) {return}
                field.accept({
                    visitArrayField: <FIELD extends Field>(field: ArrayField<FIELD>) => {
                        if (isInstanceOf(value, Y.Map)) {
                            apply(field, value)
                        }
                    },
                    visitObjectField: <FIELDS extends Fields>(field: ObjectField<FIELDS>) => {
                        if (isInstanceOf(value, Y.Map)) {
                            apply(field, value)
                        }
                    },
                    visitPointerField: (field: PointerField) => {
                        if (isNotUndefined(value)) {field.fromJSON(value as JSONValue)}
                    },
                    visitPrimitiveField: (field: PrimitiveField) => {
                        if (isNotUndefined(value)) {field.fromJSON(value as JSONValue)}
                    }
                })
            })
        }
        apply(box, source)
    }

    const fieldKey = (key: string | number): number => {
        const value = Number(key)
        assert(Number.isInteger(value) && value >= -32768 && value <= 32767
            && String(value) === String(key), "Invalid field key")
        return value
    }

    export const pathToAddress = ([uuidAsString, marker, ...fieldKeysFromPath]: ReadonlyArray<string | number>, leafKey: string): Address => {
        assert(isDefined(uuidAsString) && marker === "fields", "Invalid fields path")
        return Address.compose(UUID.parse(String(uuidAsString)), ...fieldKeysFromPath.map(fieldKey), fieldKey(leafKey))
    }

    export const findMap = (map: Y.Map<unknown>, fieldKeys: ReadonlyArray<string | number>): Y.Map<unknown> =>
        fieldKeys.reduce((map, key) => asDefined(map.get(String(key)), "Could not findMap") as Y.Map<unknown>, map)

    const createDeepMap = (struct: Readonly<Record<string, Field>>): Y.Map<unknown> => Object.entries(struct)
        .reduce((map, [key, field]) => {
            field.accept({
                visitPrimitiveField: (field: PrimitiveField): unknown => map.set(key, field.toJSON() ?? null),
                visitPointerField: (field: PointerField): unknown => map.set(key, field.toJSON() ?? null),
                visitArrayField: (field: ArrayField): unknown => map.set(key, createDeepMap(field.record())),
                visitObjectField: (field: ObjectField<import("@opendaw/lib-box").Fields>): unknown => map.set(key, createDeepMap(field.record()))
            })
            return map
        }, new Y.Map())
}