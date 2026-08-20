# Lanyard asset experiment

Candidate C was promoted byte-for-byte to `../card.glb` in `Lanyard.tsx`.
The original source remains at `../card.original.glb`. This directory retains
the reproducible experiment script, contract report, and selection rationale;
the temporary candidate binaries and comparison route are intentionally absent.

## Runtime contract

Stanza reads geometry directly from `useGLTF()` instead of mounting the source
scene graph. A compatible asset must therefore retain:

- nodes `card`, `clip`, and `clamp`, each with geometry;
- materials `base` and `metal`;
- the `card` POSITION, NORMAL, TEXCOORD_0, and index topology;
- all five source nodes and the `AuxScene > Scene > card|clip|clamp` hierarchy;
- equivalent source transforms, UVs, orientation, mesh count, primitive count,
  material count, and triangle count.

The rigid body uses Stanza's `CARD_ATTACHMENT` constants, while the three named
meshes are rendered in the same local group. Changing raw vertex coordinates or
named transforms can therefore break visual alignment even when a standalone
glTF viewer still looks correct.

`asset-report.json` contains the complete source graph and contract comparison.
Decoded geometry checks confirm exact logical attribute values and equivalent
oriented triangle topology after Meshopt decoding.

## Evaluated candidates

| Candidate | Texture | Bytes | Reduction |
| --- | --- | ---: | ---: |
| A | WebP quality 90, 1678x1677 | 442,440 | 82.00% |
| B | WebP quality 90, 1280x1279 | 333,880 | 86.42% |
| C | WebP quality 90, 1024x1023 | 273,568 | 88.87% |

All candidates use required `EXT_meshopt_compression` and
`EXT_texture_webp`. Meshopt is applied as a lossless buffer encoding step with
no quantize, simplify, weld, flatten, join, or prune transform. The texture is
the only lossy part of candidate A; B and C additionally use Lanczos3 resizing.

The former 213 KB `card.optimized.glb` was not compatible: it retained only
`card` and `clip`, had two meshes, 4,274 triangles, and a flattened scene. A
broad optimization pass evidently joined/pruned the metal geometry and removed
the named `clamp` transform. It was unreferenced and has been removed rather
than retained as an ambiguous fallback. The exact historical command is not
recorded.

## Verification

The previous comparison lab was development-only and has been removed after the
promotion. Re-run the retained experiment helper against the preserved source
and live asset to validate the contract:

```text
node scripts/lanyard-asset-experiment.mjs verify-promotion \
  src/components/lanyard/card.original.glb \
  src/components/lanyard/card.glb \
  %TEMP%/stanza-gltf-tools
```

`asset-report.json` records the candidates that were visually compared from
front, back, tilted, edge-on, and actual dashboard-size views before promotion.

## Texture residency

WebP reduces transfer size, not decoded GPU size. With mipmaps, one source or
composite atlas is approximately 14.31 MiB at 1678px, 8.33 MiB at 1280px, and
5.33 MiB at 1024px. Each generated 1024x1552 front/back artwork texture is about
8.08 MiB with mipmaps.

The current runtime retains the GLB source atlas, two generated artwork
textures, and the composite atlas. The source atlas cannot be disposed safely
without changing cached `useGLTF` material ownership and the recomposition path
used by language or identity changes. That ownership change is intentionally
outside this experiment.

KTX2 was not added. WebP is already supported by the existing GLTFLoader path;
KTX2 would require a transcoder configuration and is only justified by a later
measured GPU-memory bottleneck.
