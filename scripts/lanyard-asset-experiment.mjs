import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import * as THREE from 'three';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const ALIGNMENT = 4;

function align(value) {
  return Math.ceil(value / ALIGNMENT) * ALIGNMENT;
}

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== 2) {
    throw new Error('Expected a binary glTF 2.0 file.');
  }

  let offset = 12;
  let json;
  let bin = Buffer.alloc(0);
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8').trim());
    if (type === BIN_CHUNK) bin = Buffer.from(data);
    offset += 8 + length;
  }
  if (!json) throw new Error('GLB JSON chunk is missing.');
  return { json, bin };
}

function writeGlb({ json, bin }) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(align(jsonBytes.length), 0x20);
  jsonBytes.copy(paddedJson);
  const paddedBin = Buffer.alloc(align(bin.length));
  bin.copy(paddedBin);
  const output = Buffer.alloc(12 + 8 + paddedJson.length + 8 + paddedBin.length);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedJson.length, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  paddedJson.copy(output, 20);
  const binHeader = 20 + paddedJson.length;
  output.writeUInt32LE(paddedBin.length, binHeader);
  output.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  paddedBin.copy(output, binHeader + 8);
  return output;
}

function nodeTransform(node) {
  return {
    matrix: node.matrix || null,
    translation: node.translation || [0, 0, 0],
    rotation: node.rotation || [0, 0, 0, 1],
    scale: node.scale || [1, 1, 1],
  };
}

function graphSummary(json) {
  return (json.nodes || []).map((node, index) => ({
    index,
    name: node.name || null,
    mesh: node.mesh ?? null,
    children: node.children || [],
    ...nodeTransform(node),
  }));
}

function primitiveTriangles(json, primitive) {
  const accessor = json.accessors?.[primitive.indices];
  if (!accessor || (primitive.mode ?? 4) !== 4) return 0;
  return accessor.count / 3;
}

async function imageSummary(json, bin) {
  return Promise.all((json.images || []).map(async (image, index) => {
    const view = json.bufferViews?.[image.bufferView];
    if (!view) return { index, name: image.name || null, mimeType: image.mimeType || null };
    const start = view.byteOffset || 0;
    const bytes = bin.subarray(start, start + view.byteLength);
    const metadata = await sharp(bytes).metadata();
    return {
      index,
      name: image.name || null,
      mimeType: image.mimeType || metadata.format || null,
      width: metadata.width || null,
      height: metadata.height || null,
      channels: metadata.channels || null,
      bytes: bytes.length,
      space: metadata.space || null,
    };
  }));
}

function firstImageBytes(fileBytes) {
  const { json, bin } = parseGlb(fileBytes);
  const image = json.images?.[0];
  const view = json.bufferViews?.[image?.bufferView];
  if (!view) throw new Error('Embedded texture is missing.');
  const start = view.byteOffset || 0;
  return bin.subarray(start, start + view.byteLength);
}

async function compareImages(productionFile, candidateFile) {
  const productionBytes = firstImageBytes(await readFile(productionFile));
  const candidateBytes = firstImageBytes(await readFile(candidateFile));
  const productionMetadata = await sharp(productionBytes).metadata();
  const width = productionMetadata.width;
  const height = productionMetadata.height;
  if (!width || !height) throw new Error('Production texture dimensions are unavailable.');
  const [production, candidate] = await Promise.all([
    sharp(productionBytes).ensureAlpha().raw().toBuffer(),
    sharp(candidateBytes).resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 }).ensureAlpha().raw().toBuffer(),
  ]);
  let absoluteDifference = 0;
  let alphaDifference = 0;
  let squaredDifference = 0;
  let maxDifference = 0;
  for (let index = 0; index < production.length; index += 1) {
    const difference = Math.abs(production[index] - candidate[index]);
    absoluteDifference += difference;
    squaredDifference += difference * difference;
    maxDifference = Math.max(maxDifference, difference);
    if (index % 4 === 3) alphaDifference += difference;
  }
  const mse = squaredDifference / production.length;
  const candidateMetadata = await sharp(candidateBytes).metadata();
  return {
    comparedAt: { width, height },
    candidate: { width: candidateMetadata.width, height: candidateMetadata.height },
    meanAbsoluteDifference: absoluteDifference / production.length,
    meanAlphaDifference: alphaDifference / (production.length / 4),
    rootMeanSquareError: Math.sqrt(mse),
    peakSignalToNoiseRatio: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
    maxChannelDifference: maxDifference,
  };
}

async function inspect(file) {
  const bytes = await readFile(file);
  const { json, bin } = parseGlb(bytes);
  const meshes = (json.meshes || []).map((mesh, index) => ({
    index,
    name: mesh.name || null,
    primitiveCount: mesh.primitives?.length || 0,
    triangles: (mesh.primitives || []).reduce((sum, primitive) => sum + primitiveTriangles(json, primitive), 0),
    materials: [...new Set((mesh.primitives || []).map((primitive) => primitive.material).filter(Number.isInteger))],
  }));
  return {
    path: path.relative(process.cwd(), file).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generator: json.asset?.generator || null,
    extensionsUsed: json.extensionsUsed || [],
    extensionsRequired: json.extensionsRequired || [],
    scenes: json.scenes || [],
    nodes: graphSummary(json),
    meshes,
    materials: (json.materials || []).map((material, index) => ({ index, name: material.name || null })),
    images: await imageSummary(json, bin),
    totalTriangles: meshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
  };
}

function compareContract(production, candidate) {
  const productionNodes = new Map(production.nodes.map((node) => [node.name, node]));
  const candidateNodes = new Map(candidate.nodes.map((node) => [node.name, node]));
  const requiredNodes = ['card', 'clip', 'clamp'];
  const requiredMaterials = ['base', 'metal'];
  const matrixFor = (node) => {
    if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
    return new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation),
      new THREE.Quaternion().fromArray(node.rotation),
      new THREE.Vector3().fromArray(node.scale),
    );
  };
  const sameTransform = (left, right) => matrixFor(left).elements.every((value, index) => (
    Math.abs(value - matrixFor(right).elements[index]) <= 1e-7
  ));

  return {
    requiredNodes: Object.fromEntries(requiredNodes.map((name) => [name, {
      present: candidateNodes.has(name),
      transformMatches: candidateNodes.has(name) && sameTransform(productionNodes.get(name), candidateNodes.get(name)),
      meshPresent: Number.isInteger(candidateNodes.get(name)?.mesh),
    }])),
    requiredMaterials: Object.fromEntries(requiredMaterials.map((name) => [name, candidate.materials.some((material) => material.name === name)])),
    nodeCountMatches: production.nodes.length === candidate.nodes.length,
    meshCountMatches: production.meshes.length === candidate.meshes.length,
    materialCountMatches: production.materials.length === candidate.materials.length,
    primitiveCountMatches: production.meshes.reduce((sum, mesh) => sum + mesh.primitiveCount, 0)
      === candidate.meshes.reduce((sum, mesh) => sum + mesh.primitiveCount, 0),
    triangleCountMatches: production.totalTriangles === candidate.totalTriangles,
  };
}

async function convertTexture(input, output, maxDimension, format = 'png') {
  const parsed = parseGlb(await readFile(input));
  const { json } = parsed;
  let bin = Buffer.from(parsed.bin);

  for (const image of json.images || []) {
    const view = json.bufferViews?.[image.bufferView];
    if (!view) continue;
    const start = view.byteOffset || 0;
    const source = bin.subarray(start, start + view.byteLength);
    let pipeline = sharp(source).toColourspace('srgb');
    if (maxDimension) {
      pipeline = pipeline.resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    }
    const normalized = format === 'webp'
      ? await pipeline.webp({ quality: 90, effort: 6, smartSubsample: true }).toBuffer()
      : await pipeline.png({ compressionLevel: 9 }).toBuffer();
    const byteOffset = align(bin.length);
    bin = Buffer.concat([bin, Buffer.alloc(byteOffset - bin.length), normalized]);
    view.byteOffset = byteOffset;
    view.byteLength = normalized.length;
    image.mimeType = format === 'webp' ? 'image/webp' : 'image/png';
  }

  if (format === 'webp') {
    json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'EXT_texture_webp'])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'EXT_texture_webp'])];
    for (const texture of json.textures || []) {
      if (!Number.isInteger(texture.source)) continue;
      texture.extensions = { ...(texture.extensions || {}), EXT_texture_webp: { source: texture.source } };
      delete texture.source;
    }
  }

  json.buffers[0].byteLength = bin.length;
  await writeFile(output, writeGlb({ json, bin }));
}

async function buildReport(output, files, toolRoot) {
  const [productionFile, ...candidateFiles] = files;
  const production = await inspect(productionFile);
  const candidates = await Promise.all(candidateFiles.map(inspect));
  const report = {
    generatedAt: new Date().toISOString(),
    production,
    runtimeContract: {
      nodes: ['card', 'clip', 'clamp'],
      materials: ['base', 'metal'],
      cardGeometryRequiresUvs: true,
      cardGeometryIsSplitAtRuntime: true,
      clampGeometryIsRenderedDirectly: true,
      physicsAttachmentUsesNamedMeshTransforms: false,
      note: 'Rigid-body attachment uses CARD_ATTACHMENT constants; named mesh transforms and orientation must nevertheless remain unchanged for visual alignment.',
    },
    candidates: await Promise.all(candidates.map(async (candidate, index) => ({
      ...candidate,
      contract: compareContract(production, candidate),
      decodedGeometry: toolRoot ? await compareDecodedGeometry(productionFile, candidateFiles[index], toolRoot) : null,
      textureComparison: await compareImages(productionFile, candidateFiles[index]),
    }))),
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function compressMeshoptWithoutGeometryTransforms(input, output, toolRoot) {
  const requireFromTools = createRequire(path.resolve(toolRoot, 'package.json'));
  const { NodeIO } = requireFromTools('@gltf-transform/core');
  const { ALL_EXTENSIONS, EXTMeshoptCompression } = requireFromTools('@gltf-transform/extensions');
  const { MeshoptDecoder, MeshoptEncoder } = requireFromTools('meshoptimizer');
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
  const document = await io.read(input);
  document.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    // QUANTIZE here selects the extension's no-filter writer. We deliberately
    // do not run the quantize transform, keeping Stanza's raw geometry arrays.
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(output, document);
}

async function compareDecodedGeometry(productionFile, candidateFile, toolRoot) {
  const requireFromTools = createRequire(path.resolve(toolRoot, 'package.json'));
  const { NodeIO } = requireFromTools('@gltf-transform/core');
  const { ALL_EXTENSIONS } = requireFromTools('@gltf-transform/extensions');
  const { MeshoptDecoder } = requireFromTools('meshoptimizer');
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const [production, candidate] = await Promise.all([io.read(productionFile), io.read(candidateFile)]);
  const meshByName = (document) => new Map(document.getRoot().listNodes()
    .filter((node) => node.getName())
    .map((node) => [node.getName(), node.getMesh()]));
  const productionMeshes = meshByName(production);
  const candidateMeshes = meshByName(candidate);
  const results = {};

  for (const name of ['card', 'clip', 'clamp']) {
    const productionMesh = productionMeshes.get(name);
    const candidateMesh = candidateMeshes.get(name);
    const productionPrimitives = productionMesh?.listPrimitives() || [];
    const candidatePrimitives = candidateMesh?.listPrimitives() || [];
    let maxAbsoluteDifference = 0;
    let attributesMatch = productionPrimitives.length === candidatePrimitives.length;
    let indexSequenceMatches = true;
    let topologyMatches = true;
    const semantics = new Set();
    const triangleSignatures = (primitive) => {
      const indices = primitive.getIndices()?.getArray();
      if (!indices) return [];
      const attributes = primitive.listSemantics().sort().map((semantic) => [semantic, primitive.getAttribute(semantic)]);
      const vertex = (vertexIndex) => attributes.map(([semantic, accessor]) => {
        const values = [];
        accessor.getElement(vertexIndex, values);
        return `${semantic}:${values.map((value) => Number(value).toPrecision(10)).join(',')}`;
      }).join('|');
      const triangles = [];
      for (let offset = 0; offset < indices.length; offset += 3) {
        const vertices = [vertex(indices[offset]), vertex(indices[offset + 1]), vertex(indices[offset + 2])];
        const rotations = [vertices, [vertices[1], vertices[2], vertices[0]], [vertices[2], vertices[0], vertices[1]]];
        triangles.push(rotations.map((rotation) => rotation.join('>')).sort()[0]);
      }
      return triangles.sort();
    };
    for (let index = 0; index < productionPrimitives.length && attributesMatch; index += 1) {
      const leftPrimitive = productionPrimitives[index];
      const rightPrimitive = candidatePrimitives[index];
      const attributes = [...new Set([...leftPrimitive.listSemantics(), ...rightPrimitive.listSemantics()])].sort();
      for (const semantic of attributes) {
        semantics.add(semantic);
        const leftAccessor = leftPrimitive.getAttribute(semantic);
        const rightAccessor = rightPrimitive.getAttribute(semantic);
        if (!leftAccessor || !rightAccessor
          || leftAccessor.getCount() !== rightAccessor.getCount()
          || leftAccessor.getElementSize() !== rightAccessor.getElementSize()) {
          attributesMatch = false;
          break;
        }
        const leftElement = [];
        const rightElement = [];
        for (let element = 0; element < leftAccessor.getCount(); element += 1) {
          leftAccessor.getElement(element, leftElement);
          rightAccessor.getElement(element, rightElement);
          for (let component = 0; component < leftAccessor.getElementSize(); component += 1) {
            const difference = Math.abs(Number(leftElement[component]) - Number(rightElement[component]));
            maxAbsoluteDifference = Math.max(maxAbsoluteDifference, difference);
            if (difference > 1e-7) attributesMatch = false;
          }
        }
      }
      const leftIndices = leftPrimitive.getIndices()?.getArray();
      const rightIndices = rightPrimitive.getIndices()?.getArray();
      if (!leftIndices || !rightIndices || leftIndices.length !== rightIndices.length) {
        indexSequenceMatches = false;
        topologyMatches = false;
      } else {
        for (let element = 0; element < leftIndices.length; element += 1) {
          if (leftIndices[element] !== rightIndices[element]) indexSequenceMatches = false;
        }
        topologyMatches = topologyMatches && JSON.stringify(triangleSignatures(leftPrimitive)) === JSON.stringify(triangleSignatures(rightPrimitive));
      }
    }
    results[name] = {
      primitiveCount: candidatePrimitives.length,
      semantics: [...semantics],
      arraysMatch: attributesMatch && topologyMatches,
      attributesMatch,
      indexSequenceMatches,
      topologyMatches,
      maxAbsoluteDifference,
    };
  }
  return results;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'normalize') {
  const [input, output, maxDimension] = args;
  await convertTexture(input, output, maxDimension ? Number(maxDimension) : null);
} else if (command === 'webp') {
  const [input, output, maxDimension] = args;
  await convertTexture(input, output, maxDimension ? Number(maxDimension) : null, 'webp');
} else if (command === 'inspect') {
  console.log(JSON.stringify(await inspect(args[0]), null, 2));
} else if (command === 'report') {
  const [output, production, toolRoot, ...candidates] = args;
  const report = await buildReport(output, [production, ...candidates], toolRoot);
  console.log(JSON.stringify({
    output,
    productionBytes: report.production.bytes,
    candidates: report.candidates.map((candidate) => ({
      path: candidate.path,
      bytes: candidate.bytes,
      contract: candidate.contract,
    })),
  }, null, 2));
} else if (command === 'meshopt-lossless') {
  const [input, output, toolRoot] = args;
  await compressMeshoptWithoutGeometryTransforms(input, output, toolRoot);
} else if (command === 'compare-geometry') {
  const [production, candidate, toolRoot] = args;
  console.log(JSON.stringify(await compareDecodedGeometry(production, candidate, toolRoot), null, 2));
} else if (command === 'compare-images') {
  const [production, candidate] = args;
  console.log(JSON.stringify(await compareImages(production, candidate), null, 2));
} else if (command === 'verify-promotion') {
  const [original, promoted, toolRoot] = args;
  if (!original || !promoted || !toolRoot) {
    throw new Error('Usage: verify-promotion <original.glb> <promoted.glb> <toolRoot>');
  }
  const [originalSummary, promotedSummary, decodedGeometry] = await Promise.all([
    inspect(original),
    inspect(promoted),
    compareDecodedGeometry(original, promoted, toolRoot),
  ]);
  const contract = compareContract(originalSummary, promotedSummary);
  const contractPasses = Object.values(contract.requiredNodes).every((node) => (
    node.present && node.meshPresent && node.transformMatches
  ))
    && Object.values(contract.requiredMaterials).every(Boolean)
    && contract.nodeCountMatches
    && contract.meshCountMatches
    && contract.materialCountMatches
    && contract.primitiveCountMatches
    && contract.triangleCountMatches
    && Object.values(decodedGeometry).every((geometry) => (
      geometry.attributesMatch && geometry.topologyMatches && geometry.maxAbsoluteDifference === 0
    ));
  if (!contractPasses) throw new Error('Promoted lanyard asset failed the runtime contract.');
  console.log(JSON.stringify({
    original: originalSummary,
    promoted: promotedSummary,
    contract,
    decodedGeometry,
  }, null, 2));
} else {
  throw new Error('Usage: node scripts/lanyard-asset-experiment.mjs <normalize|webp|meshopt-lossless|compare-geometry|compare-images|inspect|report> ...');
}
