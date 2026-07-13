/// <reference types="vite/client" />

declare module '*.glb' {
  const assetUrl: string;
  export default assetUrl;
}

declare module '*.png' {
  const assetUrl: string;
  export default assetUrl;
}

declare module 'meshline' {
  import type { BufferGeometry, Color, ShaderMaterial, Texture, Vector2 } from 'three';

  export class MeshLineGeometry extends BufferGeometry {
    setPoints(points: ArrayLike<{ x: number; y: number; z: number }>): void;
  }

  export class MeshLineMaterial extends ShaderMaterial {
    color: Color;
    resolution: Vector2;
    useMap: boolean;
    map: Texture | null;
    repeat: Vector2;
    lineWidth: number;
  }
}
