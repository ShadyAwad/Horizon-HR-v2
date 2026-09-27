export type Point = { x: number; y: number };
export function clampTutorialPosition(point: Point, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 12): Point {
  return { x: Math.max(margin, Math.min(point.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)) };
}
