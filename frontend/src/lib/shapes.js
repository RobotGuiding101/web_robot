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

// ── Corner handling ──────────────────────────────────────────────────────────
//
// The arm chases a moving ServoP target through the CR5's following filter,
// which has a finite response time. A target whose direction changes 90°
// inside one 1 mm step therefore cannot be tracked exactly — the corner comes
// out rounded on the table no matter how sharp the point list is.
//
// Repeating the corner vertex (an earlier "dwell" approach here) made it
// worse, not better: commanding the same position three times in a row means
// the arm decelerates to a stop on the corner and eases out of it, which is
// exactly the rounded corner we were trying to avoid. Removing the dwell
// alone is not enough either — the follower then simply cuts the corner,
// undershooting it.
//
// A small fillet beats both. The turn becomes gradual enough for the
// follower to track with small error, so the corner the arm draws is the
// corner that was commanded, instead of an undefined blend of overshoot and
// lag. The radius is a fraction of the shape's smaller side so it stays a
// hairline at any size — 1.5% of a 200 mm edge is ~3 mm, which reads as a
// sharp rectangle while staying followable.
//
// Fillet arcs are computed in NORMALISED (u,v) space, not canvas pixels,
// because that is the space the robot mapping treats as physically square —
// a fillet built in pixels on a non-square canvas would come out elliptical on
// the table.
export const CORNER_FILLET_RATIO = 0.015
const CORNER_ARC_POINTS = 4

function filletCorner(prev, corner, next, radius, arcPoints) {
  const len1 = Math.hypot(corner.x - prev.x, corner.y - prev.y)
  const len2 = Math.hypot(next.x - corner.x, next.y - corner.y)
  if (len1 < 1e-9 || len2 < 1e-9) return [corner]

  const u1 = { x: (corner.x - prev.x) / len1, y: (corner.y - prev.y) / len1 }
  const u2 = { x: (next.x - corner.x) / len2, y: (next.y - corner.y) / len2 }
  const cosTheta = -(u1.x * u2.x + u1.y * u2.y)
  const theta = Math.acos(Math.min(1, Math.max(-1, cosTheta)))

  // A straight-through vertex has nothing to round.
  if (theta > Math.PI - 1e-3) return [corner]

  const tangent = radius / Math.tan(theta / 2)
  if (tangent > len1 * 0.5 || tangent > len2 * 0.5) return [corner]

  const bis = { x: u2.x - u1.x, y: u2.y - u1.y }
  const bisLen = Math.hypot(bis.x, bis.y)
  if (bisLen < 1e-9) return [corner]

  const centreDist = radius / Math.sin(theta / 2)
  const centre = {
    x: corner.x + (bis.x / bisLen) * centreDist,
    y: corner.y + (bis.y / bisLen) * centreDist,
  }
  const start = { x: corner.x - u1.x * tangent, y: corner.y - u1.y * tangent }
  const end = { x: corner.x + u2.x * tangent, y: corner.y + u2.y * tangent }

  const a0 = Math.atan2(start.y - centre.y, start.x - centre.x)
  const a1 = Math.atan2(end.y - centre.y, end.x - centre.x)
  let sweep = a1 - a0
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep < -Math.PI) sweep += 2 * Math.PI

  const arc = []
  for (let i = 0; i <= arcPoints; i++) {
    const a = a0 + (sweep * i) / arcPoints
    arc.push(new Point(centre.x + Math.cos(a) * radius, centre.y + Math.sin(a) * radius))
  }
  return arc
}

function filletRing(corners, radius) {
  const groups = corners.map((corner, i) => {
    const prev = corners[(i - 1 + corners.length) % corners.length]
    const next = corners[(i + 1) % corners.length]
    return filletCorner(prev, corner, next, radius, CORNER_ARC_POINTS)
  })
  const flat = groups.flat()
  flat.push(new Point(flat[0].x, flat[0].y))
  return flat
}

const toU = (pt, canvasSize) => ({
  x: pt.x / (canvasSize?.width || 1),
  y: pt.y / (canvasSize?.height || 1),
})
const fromU = (pt, canvasSize) =>
  new Point(pt.x * (canvasSize?.width || 1), pt.y * (canvasSize?.height || 1))

// Every closed shape repeats its first vertex as the last one. That is what
// makes the report's `closed` flag distinguish a deliberate shape from a
// stroke whose ends merely happen to coincide — dropping the repeat would
// silently change what gets recorded.
//
// canvasSize — optional { width, height } of the Fabric canvas element.
// Required for CORNER_FILLET_RATIO and CIRCLE: the canvas coordinate space has
// aspect ratio width:height, but the backend normalises x→u=x/width and
// y→v=y/height independently.  If width≠height a pixel-equal radius would
// become radius/width in u-space and radius/height in v-space — different
// values — so the circle is stretched into an ellipse on the physical surface.
// The fix: use the *normalised* radius (r_u = radius/width) as the canonical
// one and back-project into canvas pixels as rx=r_u*width (unchanged),
// ry=r_u*height — so after normalisation both axes share the same r_u.
export function shapePoints(tool, start, end, canvasSize) {
  if (tool === SHAPE_TOOLS.RECTANGLE) {
    const left   = Math.min(start.x, end.x)
    const right  = Math.max(start.x, end.x)
    const top    = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    const cw = canvasSize?.width  || 1
    const ch = canvasSize?.height || 1
    const corners = [
      toU(new Point(left,  top),    canvasSize),
      toU(new Point(right, top),    canvasSize),
      toU(new Point(right, bottom), canvasSize),
      toU(new Point(left,  bottom), canvasSize),
    ]
    const radius = Math.min((right - left) / cw, (bottom - top) / ch)
      * CORNER_FILLET_RATIO
    return filletRing(corners, radius).map((p) => fromU(p, canvasSize))
  }

  if (tool === SHAPE_TOOLS.TRIANGLE) {
    const left   = Math.min(start.x, end.x)
    const right  = Math.max(start.x, end.x)
    const top    = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    const cw = canvasSize?.width  || 1
    const ch = canvasSize?.height || 1
    const apexX  = (left + right) / 2
    const corners = [
      toU(new Point(apexX, top),    canvasSize),
      toU(new Point(right, bottom), canvasSize),
      toU(new Point(left,  bottom), canvasSize),
    ]
    const radius = Math.min((right - left) / cw, (bottom - top) / ch)
      * CORNER_FILLET_RATIO
    return filletRing(corners, radius).map((p) => fromU(p, canvasSize))
  }

  // ── Circle ──────────────────────────────────────────────────────────────────
  // The canvas IS the grid: u,v span [0,1] corner to corner. A radius running
  // past an edge gets silently clamped by grid_pose() into a flattened shape,
  // and the report's own numbers still look correct while it happens. Line,
  // rect and triangle are built from min/max of the two drag points so they
  // cannot leave the canvas; the circle is the only shape that can.
  const radius_px = Math.hypot(end.x - start.x, end.y - start.y)
  const cw = canvasSize?.width  || 1
  const ch = canvasSize?.height || 1

  // Clamped in NORMALISED space so the limit matches on both axes. cw/ch only
  // default to 1 as a stand-in for the aspect RATIO, so without a real
  // canvasSize there are no pixel bounds to clamp against.
  let r_norm = radius_px / cw
  if (canvasSize) {
    const cu = start.x / cw
    const cv = start.y / ch
    r_norm = Math.min(r_norm, cu, 1 - cu, cv, 1 - cv)
  }

  const rx = r_norm * cw
  const ry = r_norm * ch

  return Array.from({ length: 49 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2
    return new Point(
      start.x + Math.cos(angle) * rx,
      start.y + Math.sin(angle) * ry,
    )
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