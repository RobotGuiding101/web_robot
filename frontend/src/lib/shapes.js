// Canvas shape geometry for the Draw page's shape tools.
//
// Split out of DrawingModePage so it can be unit tested on its own — it is
// pure arithmetic on two drag points, and it is what decides the vertex list
// the backend later turns into robot waypoints, so a mistake here becomes a
// wrong path on hardware rather than a cosmetic difference.
import { Point } from 'fabric'

export const SHAPE_TOOLS = {
  RECTANGLE: 'rectangle',
  TRIANGLE: 'triangle',
  CIRCLE: 'circle',
}

// Every closed shape repeats its first vertex as the last one. That is what
// makes the report's `closed` flag distinguish a deliberate shape from a
// stroke whose ends merely happen to coincide — dropping the repeat would
// silently change what gets recorded.
export function shapePoints(tool, start, end) {
  if (tool === SHAPE_TOOLS.RECTANGLE) {
    const left = Math.min(start.x, end.x)
    const right = Math.max(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    return [
      new Point(left, top),
      new Point(right, top),
      new Point(right, bottom),
      new Point(left, bottom),
      new Point(left, top),
    ]
  }

  if (tool === SHAPE_TOOLS.TRIANGLE) {
    const left = Math.min(start.x, end.x)
    const right = Math.max(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    const apexX = (left + right) / 2
    return [
      new Point(apexX, top),
      new Point(right, bottom),
      new Point(left, bottom),
      new Point(apexX, top),
    ]
  }

  const radius = Math.hypot(end.x - start.x, end.y - start.y)
  return Array.from({ length: 49 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2
    return new Point(start.x + Math.cos(angle) * radius, start.y + Math.sin(angle) * radius)
  })
}

// Whether a point list is a closed ring — the canvas-side twin of the
// backend's `closed` flag, used to keep the two definitions from drifting.
export function isClosedRing(points) {
  if (points.length < 2) return false
  const first = points[0]
  const last = points[points.length - 1]
  return Math.abs(first.x - last.x) <= 1e-4 && Math.abs(first.y - last.y) <= 1e-4
}