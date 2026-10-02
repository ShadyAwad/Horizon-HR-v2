# Lanyard asset contract

The runtime asset is `../card.glb`; `../card.original.glb` is the source for rebuilding and contract verification. `asset-report.json` describes the asset graph and geometry comparison. Keep both assets until source regeneration and loader ownership are replaced deliberately.

## Loader and geometry

Stanza reads geometry directly from `useGLTF()` rather than mounting the source scene. Compatible assets must retain nodes `card`, `clip` and `clamp`, materials `base` and `metal`, card vertex attributes and index topology, the source node hierarchy, transforms, orientation and UVs. Physics attachment constants assume this local coordinate system. Joining meshes, flattening transforms or pruning named nodes can break alignment.

The live asset requires `EXT_meshopt_compression` and `EXT_texture_webp`. Preserve loader support when changing compression. Geometry compression must remain lossless; texture resizing and WebP encoding may be lossy.

## Verification

The retained helper verifies the live asset against the source using a separately installed glTF toolchain:

```text
node scripts/lanyard-asset-experiment.mjs verify-promotion src/components/lanyard/card.original.glb src/components/lanyard/card.glb <temporary glTF toolchain directory>
```

Check front, back, tilted and edge views at actual dashboard size after any change. `npm run test:lanyard` checks scheduler/lifecycle behavior; it does not replace visual asset inspection.

## Texture ownership

WebP reduces transfer bytes, not decoded GPU texture size. Runtime retains the source atlas, generated front/back artwork and composite atlas. Disposing the cached source texture requires coordinating `useGLTF` material ownership with language and identity recomposition. KTX2 would require explicit transcoder configuration and a measured reason to change the loader.
