/* eslint-disable react/no-unknown-property */
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame, useThree, type ThreeElement, type ThreeEvent } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
  type RapierRigidBody,
  type RigidBodyProps
} from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';
import * as THREE from 'three';

import cardGLB from './card.glb';
import { STANZA_LANYARD_TEXTURE } from './stanzaLanyardArtwork';

extend({ MeshLineGeometry, MeshLineMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    meshLineGeometry: ThreeElement<typeof MeshLineGeometry>;
    meshLineMaterial: ThreeElement<typeof MeshLineMaterial>;
  }
}

// 1x1 transparent pixel — lets useTexture be called unconditionally when a
// front/back image isn't supplied.
const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// The card model's front face is UV-mapped to the LEFT half of the texture
// atlas and the back face to the RIGHT half (measured from card.glb). Each
// custom image is composited into its own half so the two faces render
// independently, aspect-preserving (no stretching).
const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 0.755 };
const BACK_UV_RECT = { x: 0.5, y: 0, w: 0.5, h: 0.757 };

const BADGE_SCALE = 1;
const ROPE_SEGMENT_LENGTH = 1.05;
const CLIP_SEGMENT_LENGTH = ROPE_SEGMENT_LENGTH * 0.45;
const LANYARD_WIDTH = 0.22;
const STRAP_TEXTURE_REPEAT_WORLD_LENGTH = 1.35;
const STRAP_REPEAT_EPSILON = 0.02;
const ROPE_POINT_COUNT = 28;
const ROPE_SMOOTHING_RATE = 12;
const ANCHOR_EPSILON = 0.001;
const ROPE_COLLIDER_RADIUS = 0.1;
const CLIP_CONNECTOR_COLLIDER_RADIUS = 0.04;
const IDLE_YAW_AMPLITUDE = THREE.MathUtils.degToRad(7);
const IDLE_YAW_SPEED = 0.32;
const IDLE_YAW_SMOOTHING_RATE = 4;
const SETTLED_SPEED_SQ = 0.0025;
const CLICK_MOVE_THRESHOLD = 6;
const CLICK_TIME_THRESHOLD_MS = 350;
const FLIP_SMOOTHING_RATE = 10;
const FLIP_SETTLED_EPSILON = 0.01;
const BADGE_GROUP_Y = -1.2;
const BADGE_MIN_Y = 0.02290511131286621;
const BADGE_MAX_Y = 1.2293701171875;
const BADGE_HALF_WIDTH = 0.35820895433425903 * BADGE_SCALE;
const BADGE_HALF_HEIGHT = ((BADGE_MAX_Y - BADGE_MIN_Y) / 2) * BADGE_SCALE;
const BADGE_COLLIDER_Y = (BADGE_GROUP_Y + (BADGE_MIN_Y + BADGE_MAX_Y) / 2) * BADGE_SCALE;
const CARD_JOINT_Y = (BADGE_GROUP_Y + BADGE_MAX_Y) * BADGE_SCALE;
const CARD_ATTACHMENT = {
  x: 0,
  y: CARD_JOINT_Y,
  z: 0
} as const;
const CANVAS_CLEAR_COLOR = new THREE.Color(0x000000);

interface LanyardProps {
  position?: [number, number, number];
  gravity?: [number, number, number];
  fov?: number;
  transparent?: boolean;
  frontImage?: string | null;
  backImage?: string | null;
  imageFit?: 'cover' | 'contain';
  lanyardImage?: string | null;
  lanyardWidth?: number;
  anchorNdc?: { x: number; y: number } | null;
  eventSource?: HTMLElement | null;
  paused?: boolean;
  onReady?: () => void;
}

export default function Lanyard({
  position = [0, 0, 30],
  gravity = [0, -40, 0],
  fov = 20,
  transparent = true,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  lanyardImage = null,
  lanyardWidth = LANYARD_WIDTH,
  anchorNdc = null,
  eventSource = null,
  paused = false,
  onReady
}: LanyardProps) {
  const cameraConfig = useMemo(
    () => ({ position, fov }),
    [fov, position[0], position[1], position[2]],
  );
  const glOptions = useMemo(() => ({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance' as const,
  }), []);

  return (
    <div className="h-full w-full">
      <Canvas
        aria-label="Interactive employee identification badge"
        camera={cameraConfig}
        dpr={1}
        eventSource={eventSource ?? undefined}
        eventPrefix="client"
        gl={glOptions}
        onCreated={({ gl }) => gl.setClearColor(CANVAS_CLEAR_COLOR, transparent ? 0 : 1)}
      >
        <LanyardCanvasLifecycle paused={paused} />
        <ambientLight intensity={2.2} />
        <directionalLight intensity={2.4} position={[-3, 4, 8]} />
        <Physics gravity={gravity} timeStep={1 / 60} interpolate paused={paused}>
          <Band
            frontImage={frontImage}
            backImage={backImage}
            imageFit={imageFit}
            lanyardImage={lanyardImage}
            lanyardWidth={lanyardWidth}
            anchorNdc={anchorNdc}
            interactionElement={eventSource}
            idleVisualEnabled={!paused}
            onReady={onReady}
          />
        </Physics>
      </Canvas>
    </div>
  );
}

function LanyardCanvasLifecycle({ paused }: { paused: boolean }) {
  const { gl } = useThree();
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (event: WebGLContextEvent) => {
      event.preventDefault();
      if (import.meta.env.DEV) {
        console.debug('[lanyard] webgl context lost', {
          paused: pausedRef.current,
          visibility: document.visibilityState,
        });
      }
    };
    const handleContextRestored = () => {
      if (import.meta.env.DEV) console.debug('[lanyard] webgl context restored');
    };

    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);
    if (import.meta.env.DEV) console.debug('[lanyard] canvas mounted');

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      if (import.meta.env.DEV) console.debug('[lanyard] canvas unmounted');
    };
  }, [gl]);

  return null;
}

interface BandProps {
  frontImage?: string | null;
  backImage?: string | null;
  imageFit?: 'cover' | 'contain';
  lanyardImage?: string | null;
  lanyardWidth?: number;
  anchorNdc?: { x: number; y: number } | null;
  interactionElement?: HTMLElement | null;
  idleVisualEnabled?: boolean;
  onReady?: () => void;
}

type LanyardRigidBody = RapierRigidBody & {
  lerped?: THREE.Vector3;
};

const getLerpedPoint = (body: LanyardRigidBody, smoothing: number) => {
  const translation = body.translation();
  if (!body.lerped) body.lerped = new THREE.Vector3(translation.x, translation.y, translation.z);
  body.lerped.lerp(translation, smoothing);
  return body.lerped;
};

type PointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  dragOffset: THREE.Vector3;
};

const splitCardGeometry = (source: THREE.BufferGeometry) => {
  const sourceIndex = source.index;
  const normals = source.getAttribute('normal');
  const faceIndices: number[] = [];
  const edgeIndices: number[] = [];

  if (sourceIndex && normals) {
    for (let offset = 0; offset < sourceIndex.count; offset += 3) {
      const a = sourceIndex.getX(offset);
      const b = sourceIndex.getX(offset + 1);
      const c = sourceIndex.getX(offset + 2);
      const isFlatFace =
        Math.abs(normals.getZ(a)) >= 0.98 &&
        Math.abs(normals.getZ(b)) >= 0.98 &&
        Math.abs(normals.getZ(c)) >= 0.98;
      (isFlatFace ? faceIndices : edgeIndices).push(a, b, c);
    }
  }

  const faceGeometry = source.clone();
  const edgeGeometry = source.clone();
  faceGeometry.setIndex(faceIndices);
  edgeGeometry.setIndex(edgeIndices);
  faceGeometry.clearGroups();
  edgeGeometry.clearGroups();
  return { faceGeometry, edgeGeometry };
};

function Band({
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  lanyardImage = null,
  lanyardWidth = LANYARD_WIDTH,
  anchorNdc = null,
  interactionElement = null,
  idleVisualEnabled = true,
  onReady
}: BandProps) {
  const band = useRef<THREE.Mesh<InstanceType<typeof MeshLineGeometry>, InstanceType<typeof MeshLineMaterial>>>(null!);
  const fixed = useRef<RapierRigidBody>(null!);
  const j1 = useRef<LanyardRigidBody>(null!);
  const j2 = useRef<LanyardRigidBody>(null!);
  const j3 = useRef<RapierRigidBody>(null!);
  const j4 = useRef<RapierRigidBody>(null!);
  const card = useRef<RapierRigidBody>(null!);
  const interactionPivot = useRef<THREE.Group>(null!);
  const idleMotionPivot = useRef<THREE.Group>(null!);
  const flipTargetRef = useRef(0);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const readyFrames = useRef(0);
  const readyReported = useRef(false);
  const anchorLogged = useRef(false);
  const initializedLogged = useRef(false);
  const ropeInitialized = useRef(false);
  const lastRepeatX = useRef(-2.5);
  const idleElapsed = useRef(0);
  const lastAppliedAnchor = useRef<THREE.Vector3 | null>(null);
  const onReadyRef = useRef(onReady);
  const { camera, gl, size } = useThree();

  const anchorWorld = useMemo(() => {
    if (!anchorNdc) return new THREE.Vector3(0, 4, 0);

    const projected = new THREE.Vector3(anchorNdc.x, anchorNdc.y, 0).unproject(camera);
    const direction = projected.sub(camera.position).normalize();
    return camera.position.clone().add(direction.multiplyScalar(-camera.position.z / direction.z));
  }, [anchorNdc, camera, size.width, size.height]);

  const vec = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const nextCardTranslation = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);

  const segmentProps: RigidBodyProps = {
    type: 'dynamic',
    canSleep: true,
    colliders: false,
    angularDamping: 4,
    linearDamping: 4
  };
  const cardProps: RigidBodyProps = {
    ...segmentProps,
    angularDamping: 6
  };

  const { nodes, materials } = useGLTF(cardGLB) as any;
  const texture = useTexture(lanyardImage || STANZA_LANYARD_TEXTURE);
  // useTexture must be called unconditionally; use a blank pixel when an image
  // isn't supplied for a given face, then skip compositing it below.
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const backTex = useTexture(backImage || BLANK_PIXEL);
  const { faceGeometry, edgeGeometry } = useMemo(
    () => splitCardGeometry(nodes.card.geometry as THREE.BufferGeometry),
    [nodes.card.geometry]
  );

  // Composite the front/back images into the card's texture atlas (front = left
  // half, back = right half). Each image is drawn aspect-preserving (no stretch).
  const cardMap = useMemo(() => {
    const baseMap = materials.base.map as THREE.Texture;
    if (!frontImage && !backImage) return baseMap;

    const baseImg = baseMap.image as any;
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseMap;
    // Keep the original baked atlas for the card edges and any untouched face.
    ctx.drawImage(baseImg, 0, 0, W, H);

    const drawFitted = (img: any, rect: typeof FRONT_UV_RECT) => {
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const pick = imageFit === 'contain' ? Math.min : Math.max;
      const scale = pick(rw / img.width, rh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = rx + (rw - dw) / 2;
      const dy = ry + (rh - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    };

    if (frontImage && frontTex.image) drawFitted(frontTex.image, FRONT_UV_RECT);
    if (backImage && backTex.image) drawFitted(backTex.image, BACK_UV_RECT);

    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 4;
    composite.needsUpdate = true;
    return composite;
  }, [frontImage, backImage, imageFit, frontTex, backTex, materials.base.map]);

  const faceMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    map: cardMap,
    clearcoat: 0.65,
    clearcoatRoughness: 0.15,
    roughness: 0.9,
    metalness: 0.8
  }), [cardMap]);

  const edgeMaterial = useMemo(() => {
    const material = (materials.base as THREE.MeshStandardMaterial).clone();
    material.name = 'stanza-badge-edge';
    material.map = null;
    material.color.set('#0A3A2A');
    material.roughness = 0.38;
    material.metalness = 0.32;
    material.envMapIntensity = 0.35;
    material.needsUpdate = true;
    return material;
  }, [materials.base]);

  useEffect(() => () => {
    faceGeometry.dispose();
    edgeGeometry.dispose();
    faceMaterial.dispose();
    edgeMaterial.dispose();
  }, [edgeGeometry, edgeMaterial, faceGeometry, faceMaterial]);

  useEffect(() => {
    const anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
    const configureTexture = (map: THREE.Texture, clampToEdge: boolean) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      map.generateMipmaps = true;
      map.anisotropy = anisotropy;
      if (clampToEdge) {
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
      } else {
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.ClampToEdgeWrapping;
      }
      map.needsUpdate = true;
    };

    [cardMap, frontTex, backTex].forEach((map) => configureTexture(map, true));
    configureTexture(texture, false);
  }, [backTex, cardMap, frontTex, gl, texture]);
  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3()
      ])
  );
  const ropePoints = useMemo(
    () => Array.from({ length: ROPE_POINT_COUNT }, () => new THREE.Vector3()),
    []
  );
  const [dragged, drag] = useState<false | THREE.Vector3>(false);
  const isDraggingRef = useRef(false);
  const [hovered, hover] = useState(false);

  const endDrag = useCallback(() => {
    isDraggingRef.current = false;
    pointerGestureRef.current = null;
    document.documentElement.classList.remove('stanza-lanyard-dragging');
    interactionElement?.classList.remove('stanza-lanyard-interacting');
    drag(false);
  }, [interactionElement]);

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], ROPE_SEGMENT_LENGTH]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], ROPE_SEGMENT_LENGTH]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], ROPE_SEGMENT_LENGTH]);
  useRopeJoint(j3, j4, [[0, 0, 0], [0, 0, 0], CLIP_SEGMENT_LENGTH]);
  useSphericalJoint(j4, card, [
    [0, 0, 0],
    [CARD_ATTACHMENT.x, CARD_ATTACHMENT.y, CARD_ATTACHMENT.z]
  ]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab';
      return () => {
        document.body.style.cursor = 'auto';
      };
    }
  }, [hovered, dragged]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!fixed.current) return;

    if (lastAppliedAnchor.current?.distanceTo(anchorWorld) <= ANCHOR_EPSILON) return;
    if (!lastAppliedAnchor.current) lastAppliedAnchor.current = new THREE.Vector3();
    lastAppliedAnchor.current.copy(anchorWorld);
    fixed.current.setTranslation(anchorWorld, true);
    [j1, j2, j3, card].forEach(ref => ref.current?.wakeUp());
  }, [anchorWorld]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug('[lanyard] physics mounted');
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const sleepCheck = window.setTimeout(() => {
      console.debug('[lanyard sleep state]', {
        j1: j1.current?.isSleeping(),
        j2: j2.current?.isSleeping(),
        j3: j3.current?.isSleeping(),
        card: card.current?.isSleeping(),
        cardTransform: card.current ? {
          translation: card.current.translation(),
          rotation: card.current.rotation(),
          linearVelocity: card.current.linvel(),
          angularVelocity: card.current.angvel()
        } : null
      });
    }, 5000);
    return () => window.clearTimeout(sleepCheck);
  }, []);

  useEffect(() => {
    const stopDragging = () => {
      endDrag();
      hover(false);
    };
    window.addEventListener('blur', stopDragging);
    return () => {
      window.removeEventListener('blur', stopDragging);
      endDrag();
    };
  }, [endDrag]);

  useEffect(() => {
    if (!import.meta.env.DEV || anchorLogged.current || !anchorNdc) return;
    anchorLogged.current = true;
    console.debug('[lanyard anchor]', {
      screen: {
        x: ((anchorNdc.x + 1) / 2) * size.width,
        y: ((1 - anchorNdc.y) / 2) * size.height
      },
      ndc: anchorNdc,
      world: anchorWorld
    });
  }, [anchorNdc, anchorWorld, size.height, size.width]);

  useFrame((state, delta) => {
    if (isDraggingRef.current && dragged && typeof dragged !== 'boolean') {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      nextCardTranslation.x = vec.x - dragged.x;
      nextCardTranslation.y = vec.y - dragged.y;
      nextCardTranslation.z = vec.z - dragged.z;
      card.current?.setNextKinematicTranslation(nextCardTranslation);
    }
    if (
      !fixed.current ||
      !j1.current ||
      !j2.current ||
      !j3.current ||
      !j4.current ||
      !card.current ||
      !band.current
    ) {
      return;
    }

    const safeDelta = Math.min(delta, 1 / 30);
    const smoothing = 1 - Math.exp(-ROPE_SMOOTHING_RATE * safeDelta);
    const bodiesSleeping = card.current.isSleeping() && j1.current.isSleeping() && j2.current.isSleeping() && j3.current.isSleeping() && j4.current.isSleeping();
    const shouldUpdateRope = !ropeInitialized.current || isDraggingRef.current || !bodiesSleeping;

    if (shouldUpdateRope) {
      curve.points[0].copy(j4.current.translation());
      curve.points[1].copy(getLerpedPoint(j3.current, smoothing));
      curve.points[2].copy(getLerpedPoint(j2.current, smoothing));
      curve.points[3].copy(getLerpedPoint(j1.current, smoothing));
      curve.points[4].copy(fixed.current.translation());

      let valid = true;
      for (let index = 0; index < ROPE_POINT_COUNT; index += 1) {
        const point = curve.getPoint(index / (ROPE_POINT_COUNT - 1), ropePoints[index]);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
          valid = false;
          break;
        }
      }
      if (!valid) {
        if (import.meta.env.DEV) console.warn('[lanyard] skipped invalid rope frame');
        return;
      }

      band.current.geometry.setPoints(ropePoints);
      ropeInitialized.current = true;

      let renderedLength = 0;
      for (let index = 1; index < ROPE_POINT_COUNT; index += 1) {
        renderedLength += ropePoints[index - 1].distanceTo(ropePoints[index]);
      }
      const repeatX = Math.max(1, renderedLength / STRAP_TEXTURE_REPEAT_WORLD_LENGTH);
      if (Math.abs(repeatX - lastRepeatX.current) > STRAP_REPEAT_EPSILON) {
        lastRepeatX.current = repeatX;
        band.current.material.repeat.set(-repeatX, 1);
      }
    }

    if (import.meta.env.DEV && !initializedLogged.current) {
      initializedLogged.current = true;
      console.debug('[lanyard initialized]', {
        fixed: fixed.current.translation(),
        j1: j1.current.translation(),
        j2: j2.current.translation(),
        j3: j3.current.translation(),
        j4: j4.current.translation(),
        card: card.current.translation()
      });
    }

    if (!readyReported.current) {
      readyFrames.current += 1;
      if (readyFrames.current >= 2) {
        readyReported.current = true;
        onReadyRef.current?.();
      }
    }

    let isFlipActive = false;
    if (interactionPivot.current) {
      const currentYaw = interactionPivot.current.rotation.y;
      const angleDelta = Math.atan2(
        Math.sin(flipTargetRef.current - currentYaw),
        Math.cos(flipTargetRef.current - currentYaw)
      );
      isFlipActive = Math.abs(angleDelta) > FLIP_SETTLED_EPSILON;
      const flipSmoothing = 1 - Math.exp(-FLIP_SMOOTHING_RATE * safeDelta);
      interactionPivot.current.rotation.y = currentYaw + angleDelta * flipSmoothing;
      if (!isFlipActive) interactionPivot.current.rotation.y = flipTargetRef.current;
    }

    if (idleMotionPivot.current) {
      let isSettled = card.current.isSleeping();
      if (!isSettled) {
        const linearVelocity = card.current.linvel();
        const angularVelocity = card.current.angvel();
        const linearSpeedSq =
          linearVelocity.x * linearVelocity.x +
          linearVelocity.y * linearVelocity.y +
          linearVelocity.z * linearVelocity.z;
        const angularSpeedSq =
          angularVelocity.x * angularVelocity.x +
          angularVelocity.y * angularVelocity.y +
          angularVelocity.z * angularVelocity.z;
        isSettled = linearSpeedSq < SETTLED_SPEED_SQ && angularSpeedSq < SETTLED_SPEED_SQ;
      }
      idleElapsed.current += safeDelta;
      const targetYaw = idleVisualEnabled && !isDraggingRef.current && !isFlipActive && isSettled
        ? Math.sin(idleElapsed.current * IDLE_YAW_SPEED) * IDLE_YAW_AMPLITUDE
        : 0;
      const yawSmoothing = 1 - Math.exp(-IDLE_YAW_SMOOTHING_RATE * safeDelta);
      idleMotionPivot.current.rotation.y = THREE.MathUtils.lerp(
        idleMotionPivot.current.rotation.y,
        targetYaw,
        yawSmoothing
      );
    }

  });

  curve.curveType = 'centripetal';
  return (
    <>
      <RigidBody position={[anchorWorld.x, anchorWorld.y, anchorWorld.z]} ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[anchorWorld.x, anchorWorld.y - ROPE_SEGMENT_LENGTH, anchorWorld.z]} ref={j1} {...segmentProps} type="dynamic">
          <BallCollider args={[ROPE_COLLIDER_RADIUS]} />
        </RigidBody>
        <RigidBody position={[anchorWorld.x, anchorWorld.y - ROPE_SEGMENT_LENGTH * 2, anchorWorld.z]} ref={j2} {...segmentProps} type="dynamic">
          <BallCollider args={[ROPE_COLLIDER_RADIUS]} />
        </RigidBody>
        <RigidBody position={[anchorWorld.x, anchorWorld.y - ROPE_SEGMENT_LENGTH * 3, anchorWorld.z]} ref={j3} {...segmentProps} type="dynamic">
          <BallCollider args={[ROPE_COLLIDER_RADIUS]} />
        </RigidBody>
        <RigidBody position={[anchorWorld.x, anchorWorld.y - ROPE_SEGMENT_LENGTH * 3 - CLIP_SEGMENT_LENGTH, anchorWorld.z]} ref={j4} {...segmentProps} type="dynamic">
          <BallCollider args={[CLIP_CONNECTOR_COLLIDER_RADIUS]} sensor />
        </RigidBody>
        <RigidBody
          position={[
            anchorWorld.x,
            anchorWorld.y - ROPE_SEGMENT_LENGTH * 3 - CLIP_SEGMENT_LENGTH - CARD_ATTACHMENT.y,
            anchorWorld.z
          ]}
          ref={card}
          {...cardProps}
          type={dragged ? 'kinematicPosition' : 'dynamic'}
        >
          <CuboidCollider
            args={[BADGE_HALF_WIDTH, BADGE_HALF_HEIGHT, 0.04]}
            position={[0, BADGE_COLLIDER_Y, 0]}
          />
          <group
            ref={interactionPivot}
            position={[0, CARD_ATTACHMENT.y, 0]}
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerMove={(e: ThreeEvent<PointerEvent>) => {
              const gesture = pointerGestureRef.current;
              if (!gesture || gesture.pointerId !== e.pointerId || gesture.moved) return;
              const deltaX = e.nativeEvent.clientX - gesture.startX;
              const deltaY = e.nativeEvent.clientY - gesture.startY;
              if (deltaX * deltaX + deltaY * deltaY <= CLICK_MOVE_THRESHOLD * CLICK_MOVE_THRESHOLD) return;

              gesture.moved = true;
              isDraggingRef.current = true;
              document.documentElement.classList.add('stanza-lanyard-dragging');
              interactionElement?.classList.add('stanza-lanyard-interacting');
              [card, j1, j2, j3, j4].forEach(ref => ref.current?.wakeUp());
              drag(gesture.dragOffset);
            }}
            onPointerUp={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              const gesture = pointerGestureRef.current;
              if (gesture && gesture.pointerId === e.pointerId) {
                const deltaX = e.nativeEvent.clientX - gesture.startX;
                const deltaY = e.nativeEvent.clientY - gesture.startY;
                const elapsed = performance.now() - gesture.startTime;
                const isClick = !gesture.moved &&
                  deltaX * deltaX + deltaY * deltaY <= CLICK_MOVE_THRESHOLD * CLICK_MOVE_THRESHOLD &&
                  elapsed <= CLICK_TIME_THRESHOLD_MS;
                if (isClick) {
                  flipTargetRef.current = flipTargetRef.current === 0 ? Math.PI : 0;
                }
              }
              const target = e.target as Element;
              if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
              endDrag();
            }}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              const target = e.target as Element;
              target.setPointerCapture(e.pointerId);
              pointerGestureRef.current = {
                pointerId: e.pointerId,
                startX: e.nativeEvent.clientX,
                startY: e.nativeEvent.clientY,
                startTime: performance.now(),
                moved: false,
                dragOffset: new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation()))
              };
            }}
          >
            <group ref={idleMotionPivot}>
              <group position={[0, -CARD_ATTACHMENT.y, 0]} scale={BADGE_SCALE}>
                <group position={[0, BADGE_GROUP_Y, -0.05]}>
                  <mesh geometry={faceGeometry} material={faceMaterial} />
                  <mesh geometry={edgeGeometry} material={edgeMaterial} />
                  <mesh geometry={nodes.clip.geometry} material={materials.metal} material-roughness={0.3} />
                  <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
                </group>
              </group>
            </group>
          </group>
        </RigidBody>
      <mesh ref={band}>
        <meshLineGeometry />
        <meshLineMaterial
          color="#d7f5e9"
          depthTest={false}
          resolution={[1000, 1000]}
          useMap
          map={texture}
          repeat={[-2.5, 1]}
          lineWidth={lanyardWidth}
        />
      </mesh>
    </>
  );
}
