# Vehicle models from Blender

Every vehicle is modelled in code (`web/src/vehicles/models/catalogue.ts`). Any of them can be
replaced by a model made in Blender, one at a time.

## Exporting

- **Units:** metres, at real size (an IC2000 coach is 26.8 m long).
- **Axes:** x forward (the direction of travel), y to the left, z up. In Blender's glTF exporter,
  untick *+Y Up* so z stays up.
- **Origin:** under the middle of the vehicle: on the rails for a train, at the waterline for a
  boat, at the floor for a cabin (and its rope `CABIN_ROPE_HEIGHT_M` above it).
- **Format:** glTF binary (`.glb`), saved here, e.g. `web/public/models/re460.glb`.
- **Size:** keep it light (a few thousand triangles): hundreds of copies are drawn at once.

## Using it

In the kind that draws it (for example `trainKind.ts`), use a `GltfModel` instead of a
`MeshModel` for the part:

```ts
new LevelOfDetail(new GltfModel("models/re460.glb", 18.5), new BoxModel(boxOf(train.lead)));
```

The second argument is the model's length in metres; the level of detail uses it to decide when
the model is worth drawing. A glTF model keeps its own materials (the palette colour isn't
applied), so paint it in Blender.

**Not yet tried with a real model.** `GltfModel` compiles and follows the same poses as the
built-in models, but no `.glb` has been rendered with it yet. With the first one, check in
`make smoke` that it points forward and stands upright; if it lies on its side, the export
used glTF's usual +Y up, and the axis option above is the fix.
