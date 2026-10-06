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

// How many times each corner vertex is repeated for rect/triangle shapes.
// The robot (servo mode) has inertia — it needs to dwell at each 90° corner
// so the servo catches up before it starts the next segment, otherwise the
// arm cuts the corner and the shape looks rounded. Repeating the same target
// coordinate forces extra ServoP calls at the same destination, acting as a
// brief dwell without an explicit sleep. 3 repeats ≈ 60ms at 50Hz — enough
// to let the dynamic-follow filter settle on a sharp vertex.
const CORNER_DWELL = 3

// Every closed shape repeats its first vertex as the last one. That is what
// makes the report's `closed` flag distinguish a deliberate shape from a
// stroke whose ends merely happen to coincide — dropping the repeat would
// silently change what gets recorded.
//
// canvasSize — optional { width, height } of the Fabric canvas element.
// Required only for CIRCLE: the canvas coordinate space has aspect ratio
// width:height, but the backend normalises x→u=x/width and y→v=y/height
// independently.  If width≠height a pixel-equal radius would become
// radius/width in u-space and radius/height in v-space — different values —
// so the circle is stretched into an ellipse on the physical surface.
// The fix: use the *normalised* radius (r_u = radius/width) as the canonical
// one and back-project into canvas pixels as rx=r_u*width (unchanged),
// ry=r_u*height — so after normalisation both axes share the same r_u.
export function shapePoints(tool, start, end, canvasSize) {
  if (tool === SHAPE_TOOLS.RECTANGLE) {
    const left   = Math.min(start.x, end.x)
    const right  = Math.max(start.x, end.x)
    const top    = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    // Dwell at every corner so servo mode settles before turning 90°.
    const TL = new Point(left,  top)
    const TR = new Point(right, top)
    const BR = new Point(right, bottom)
    const BL = new Point(left,  bottom)
    const dwell = (pt) => Array(CORNER_DWELL).fill(pt)
    return [
      ...dwell(TL),
      ...dwell(TR),
      ...dwell(BR),
      ...dwell(BL),
      TL,  // close the ring
    ]
  }

  if (tool === SHAPE_TOOLS.TRIANGLE) {
    const left   = Math.min(start.x, end.x)
    const right  = Math.max(start.x, end.x)
    const top    = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    const apexX  = (left + right) / 2
    const apex   = new Point(apexX, top)
    const TR     = new Point(right, bottom)
    const TL     = new Point(left,  bottom)
    const dwell  = (pt) => Array(CORNER_DWELL).fill(pt)
    return [
      ...dwell(apex),
      ...dwell(TR),
      ...dwell(TL),
      apex,  // close the ring
    ]
  }

  // ── Circle ──────────────────────────────────────────────────────────────────
  // radius_px is the drag distance in canvas pixel-space (what the user sees).
  const radius_px = Math.hypot(end.x - start.x, end.y - start.y)

  // If canvas dimensions are provided, compensate for aspect ratio so the
  // normalised u/v radii are equal (true circle on physical surface).
  // rx stays as-is (pixel radius in X → u = x/cw keeps the same ratio).
  // ry is scaled by ch/cw so that v = y/ch maps the same normalised radius.
  const cw = canvasSize?.width  || 1
  const ch = canvasSize?.height || 1
  const rx = radius_px              // canvas pixels in X direction
  const ry = radius_px * (ch / cw)  // scaled so ry/ch == rx/cw

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