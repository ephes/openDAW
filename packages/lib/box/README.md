_This package is part of the openDAW SDK_

# @opendaw/lib-box

Graph-based object modeling system with serialization, transactions, and pointer management for TypeScript projects.

## Wishlist

* Introduce readonly fields (cannot only be written in the constructing phase)
* Introduce meta-fields (compile time only)
* Add array with all TypeMap keys

## Core Architecture

* **box.ts** - Core Box class for graph nodes with field management
* **vertex.ts** - Vertex interface and visitor pattern definitions
* **graph.ts** - BoxGraph class for managing object relationships
* **field.ts** - Field abstraction for object properties
* **address.ts** - Addressing system for graph navigation

## Field Types

* **primitive.ts** - Primitive field types (boolean, number, string)
* **array.ts** - Array field implementations
* **object.ts** - Object field for nested structures
* **pointer.ts** - Pointer field for object references

## Graph Management

Vertex callbacks run in subscription order. A throwing callback stops sibling
delivery and propagates its original error. Subscriptions created during dispatch
remain deferred until the outermost dispatch exits, including exceptional exits;
cancelling a deferred subscription prevents its installation. A nested event does
not activate subscriptions created inside its enclosing event.

* **graph-edges.ts** - Edge management for graph relationships
* **pointer-hub.ts** - Hub for managing incoming pointer connections
* **dispatchers.ts** - Event dispatching system for updates
* **updates.ts** - Update event definitions and handling

## Serialization & Persistence

* **serializer.ts** - Serialization utilities for objects
* **sync.ts** - Synchronization utilities
* **sync-source.ts** - Source-side synchronization
* **sync-target.ts** - Target-side synchronization

## Editing & Transactions

* **editing.ts** - Undo/redo system for graph modifications
* **indexed-box.ts** - Indexed box implementation for efficient lookups

## Transaction Mechanism

The box system uses transactions to batch changes and ensure consistency. Understanding the transaction lifecycle is crucial for working with the system.

### Transaction Lifecycle

1. **`beginTransaction()`** - Starts a transaction, sets `#inTransaction = true`
2. **Changes are made** - Field values updated, pointers modified
3. **`endTransaction()`** - Commits changes and fires deferred notifications

### Pointer Updates and Deferred Notifications

When a pointer is changed via `refer()`, two things happen:

1. **Immediate**: Graph edges are updated synchronously
   - `graph.edges().connect(pointer, address)` is called
   - The pointer hub's `incoming()` returns the new state immediately

2. **Deferred**: Notifications are batched until `endTransaction()`
   - Pointer changes are recorded in `#pointerTransactionState`
   - At `endTransaction()`, notifications fire in the order changes were made:
     ```typescript
     initial.ifSome(address => vertex.pointerHub.onRemoved(pointer))
     final.ifSome(address => vertex.pointerHub.onAdded(pointer))
     ```

### Implications for Adapters

When creating adapters during a transaction:

1. **`catchupAndSubscribe()`** on a pointer hub will:
   - Catch up with current edges (immediately available)
   - Subscribe to future `onAdded`/`onRemoved` notifications (deferred)

2. **Order of notifications** at `endTransaction()`:
   - Determined by the `index` field in `#pointerTransactionState`
   - Index is assigned when the pointer change is recorded
   - Earlier changes fire before later changes

### Example: Creating a Track and Moving a Region

```typescript
editing.modify(() => {
    // 1. Create new track (deferred: track added notification)
    const newTrack = projectApi.createNoteTrack(audioUnit, index)

    // 2. Get adapter - this creates TrackRegions which subscribes to pointer hub
    //    At this point, no regions are on this track yet
    const adapter = boxAdapters.adapterFor(newTrack, TrackBoxAdapter)

    // 3. Move region to new track (deferred: region added notification)
    regionBox.regions.refer(adapter.box.regions)
})
// After modify() returns, endTransaction() has been called:
// - "track added" notification fires -> TracksManager.onAdd() -> UI created
// - "region added" notification fires -> TrackRegions.onAdded() -> dispatchChange()
```

### Box Construction During Transaction

When creating a box inside a transaction (`TrackBox.create()`):
- The `#constructingBox` flag is set
- Pointer updates during construction are added to `#deferredPointerUpdates`
- These are processed at the start of `endTransaction()` before other notifications

### Key Points

- **Edges are synchronous**: `pointerHub.incoming()` reflects changes immediately
- **Notifications are deferred**: `onAdded`/`onRemoved` fire at `endTransaction()`
- **Order matters**: Notifications fire in the order changes were made
- **Adapter creation timing**: Creating an adapter during a transaction means its subscriptions won't receive notifications for changes made earlier in the same transaction (those are caught up via `catchupAndSubscribe`)

## Resource Boxes

Boxes can be marked as resources using the `resource` property. Resources act as endpoints in dependency collection, useful for copy/paste operations.

### Resource Types

| Type | Description | UUID on Copy |
|------|-------------|--------------|
| `"external"` | References something outside the project (files, etc.) | Keep original |
| `"internal"` | Project-level shared resource | Remap to target's existing |

### Usage in BoxSchema

```typescript
export const AudioFileBox: BoxSchema<Pointers> = {
    type: "box",
    class: {...},
    pointerRules: {...},
    resource: "external"  // Marks as external resource
}
```

### Accessing Resource Type

```typescript
const box = AudioFileBox.create(graph, uuid)
console.log(box.resource)  // "external"
console.log(AudioFileBox.Resource)  // "external" (static property)
```

## Dependency Collection

The `dependenciesOf` method collects boxes that depend on a given box. This is used for operations like delete and copy.

### Options

```typescript
dependenciesOf(box: Box, options: {
    excludeBox?: Predicate<Box>      // Filter out specific boxes
    alwaysFollowMandatory?: boolean  // Bypass incoming pointer check
    stopAtResources?: boolean        // Stop traversal at resource boxes
} = {}): Dependencies
```

### stopAtResources Behavior

When `stopAtResources: true`:

1. **Resource boxes ARE added** to the dependency set (they need to be copied)
2. **Children are included**: Incoming edges to FIELDS (`!address.isBox()`) are followed
3. **Users are excluded**: Incoming edges to the BOX itself (`address.isBox()`) are NOT followed
4. **Outgoing edges are skipped**: Resources don't have dependencies we need to follow

### Example: AudioRegion → AudioFileBox ← TransientMarker

```typescript
// Scenario:
// Region → AudioFileBox (external resource)
// TransientMarker → AudioFileBox.children (points to FIELD)
// OtherRegion → AudioFileBox (points to BOX)

const {boxes} = graph.dependenciesOf(region, {
    stopAtResources: true,
    alwaysFollowMandatory: true
})

// Result:
// - AudioFileBox: included (resource endpoint)
// - TransientMarker: included (child, points to field)
// - OtherRegion: excluded (user, points to box)
```

### Differentiating Children vs Users

The key distinction is the target address:

- **Child** (include): `pointer.targetAddress.isBox() === false` - points to a field within the resource
- **User** (exclude): `pointer.targetAddress.isBox() === true` - points to the resource box itself

This allows resource boxes to have "owned" children that are always included when copying, while preventing other boxes that merely reference the resource from being pulled in.
## Binary project compatibility

Unknown field keys are skipped as opaque length-prefixed frames, including empty
frames. A frame admits at most 64 MiB; counts must be nonnegative signed 16-bit
values and every header/payload must fit the remaining input before allocation.
Framed readers require a `DataInput.remaining()` implementation (provided by
`ByteArrayInput`). Supported field decode errors throw `Serializer.DecodeError`
with bounded structural context, without copying decoder messages or payloads.
This is deliberate: a project whose supported field cannot be decoded is refused
instead of loading with silent defaults that a later save would persist.
`BoxGraph.fromArrayBuffer` aborts its own failed import transaction, removes staged
boxes/edges and permits a subsequent import. Load into a fresh graph and publish
it only after success to preserve the currently open project on refusal.

## Replication failure ownership

Sync targets preflight supported update envelopes (including 16-byte UUIDs and
Int16Array field paths up to 127 entries), then check actual primitive/pointer
kinds and primitive value domains while applying the batch (Float32 fields accept
any number, including the -Infinity used by decibel minimums). New boxes may be
referenced later in that batch. Unknown operations, malformed data, missing
vertices or incompatible field values refuse the entire batch and abort only
the target-owned open transaction. A subsequent valid batch may be received;
transport owners must handle the surfaced failure and resynchronize when needed.

Sync sources detach committed batches before sending. A synchronous send failure
sets `failed`, unsubscribes the source from graph updates and is reported
asynchronously (a rejected promise, like other end-transaction observer failures),
so the committed transaction still reaches the remaining transaction listeners and
undo history. Further local edits are allowed but are not transmitted;
checksum requests reject with a resynchronization diagnostic. Do not retry that
sender or assume its failed batch was delivered: replace it and initialize a new
empty target from a fresh snapshot (`new SyncSource(graph, messenger, true)`).
