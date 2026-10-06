// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { shapePoints, isClosedRing, SHAPE_TOOLS, CORNER_FILLET_RATIO } from './shapes'

const at = (pts) => pts.map((p) => [p.x, p.y])

// Each corner becomes a fillet arc of CORNER_ARC_POINTS + 1 samples, then one
// closing point repeats the first to mark the ring as deliberately closed.
// rectangle: 4 corners × 5 + 1 = 21, triangle: 3 × 5 + 1 = 16.
const ARC_SAMPLES = 5

const minGap = (pts) => {
  let worst = Infinity
  for (let i = 1; i < pts.length; i++) {
    worst = Math.min(worst, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  return worst
}

const maxTurnDeg = (pts) => {
  let worst = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1]
    const v1x = b.x - a.x, v1y = b.y - a.y
    const v2x = c.x - b.x, v2y = c.y - b.y
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y)
    if (l1 < 1e-9 || l2 < 1e-9) continue
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2)
    const deg = Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI
    if (deg > worst) worst = deg
  }
  return worst
}

const SQUARE = { width: 500, height: 500 }

describe('rectangle', () => {
  it('emits one fillet arc per corner plus the closing repeat', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 }, SQUARE)
    expect(pts).toHaveLength(4 * ARC_SAMPLES + 1)
  })

  it('never repeats a point, so the arm is never told to hold a corner', () => {
    // The old corner dwell emitted each vertex 3x in a row. That made the arm
    // stop on the corner and the CR5's following filter rounded the stop —
    // the reason corners looked rounded on hardware.
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 }, SQUARE)
    expect(minGap(pts)).toBeGreaterThan(0)
  })

  it('turns gradually instead of snapping through 90 degrees', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 }, SQUARE)
    expect(maxTurnDeg(pts)).toBeLessThan(40)
  })

  it('is a closed ring', () => {
    expect(isClosedRing(shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 50, y: 50 }, SQUARE))).toBe(true)
  })

  it('reaches the drag bounds', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 }, SQUARE)
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(10, 6)
    expect(Math.max(...xs)).toBeCloseTo(110, 6)
    expect(Math.min(...ys)).toBeCloseTo(20, 6)
    expect(Math.max(...ys)).toBeCloseTo(220, 6)
  })

  it('stays inside the bounding box of the drag', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 }, SQUARE)
    expect(pts.every((p) => p.x >= 10 - 1e-6 && p.x <= 110 + 1e-6)).toBe(true)
    expect(pts.every((p) => p.y >= 20 - 1e-6 && p.y <= 220 + 1e-6)).toBe(true)
  })

  it('normalises a drag that runs right-to-left or upwards', () => {
    const fwd = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 }, SQUARE)
    const rev = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 110, y: 220 }, { x: 10, y: 20 }, SQUARE)
    expect(at(rev)).toEqual(at(fwd))
  })

  it('survives a zero-size drag with finite coords', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 30, y: 30 }, { x: 30, y: 30 }, SQUARE)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(pts.every((p) => p.x === 30 && p.y === 30)).toBe(true)
  })
})

describe('triangle', () => {
  it('emits one fillet arc per corner plus the closing repeat', () => {
    expect(shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 80, y: 60 }, SQUARE))
      .toHaveLength(3 * ARC_SAMPLES + 1)
  })

  it('never repeats a point', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 }, SQUARE)
    expect(minGap(pts)).toBeGreaterThan(0)
  })

  it('turns gradually at the apex', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 }, SQUARE)
    expect(maxTurnDeg(pts)).toBeLessThan(70)
  })

  it('is a closed ring', () => {
    expect(isClosedRing(shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 5, y: 5 }, { x: 95, y: 85 }, SQUARE))).toBe(true)
  })

  it('normalises a reversed drag', () => {
    const fwd = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 }, SQUARE)
    const rev = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 100, y: 100 }, { x: 0, y: 0 }, SQUARE)
    expect(at(rev)).toEqual(at(fwd))
  })

  it('is symmetric about the vertical centre line', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 20, y: 0 }, { x: 80, y: 100 }, SQUARE)
    const apexX = 50
    const leftMost = Math.min(...pts.map((p) => p.x))
    const rightMost = Math.max(...pts.map((p) => p.x))
    expect(rightMost - apexX).toBeCloseTo(apexX - leftMost, 6)
    const topMost = Math.min(...pts.map((p) => p.y))
    expect(topMost).toBeGreaterThan(0)
    expect(topMost).toBeLessThan(100 * CORNER_FILLET_RATIO * 3)
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(100, 6)
  })

  it('survives a zero-size drag without NaN', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 12, y: 12 }, { x: 12, y: 12 }, SQUARE)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('corner fillet sizing', () => {
  it('cuts the corner by roughly CORNER_FILLET_RATIO of the shape size', () => {
    const cs = { width: 1000, height: 1000 }
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 200, y: 200 }, cs)
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    // The fillet never touches the sharp vertex, so the point nearest (0,0)
    // sits one tangent-length in along each edge.
    const nearest = Math.min(...pts.map((p) => Math.hypot(p.x - 0, p.y - 0)))
    const expected = 200 * CORNER_FILLET_RATIO
    expect(nearest).toBeGreaterThan(expected * 0.2)
    expect(nearest).toBeLessThan(expected * 2.2)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(200, 6)
  })

  it('scales the fillet with the shape, not with the canvas', () => {
    const small = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 50, y: 50 }, SQUARE)
    const large = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 200, y: 200 }, SQUARE)
    const cutSmall = Math.min(...small.map((p) => Math.hypot(p.x, p.y)))
    const cutLarge = Math.min(...large.map((p) => Math.hypot(p.x, p.y)))
    expect(cutLarge / cutSmall).toBeCloseTo(4, 1)
  })

  it('keeps the fillet circular in normalised space on a 2:1 canvas', () => {
    const cs = { width: 1000, height: 500 }
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 400, y: 200 }, cs)
    for (const p of pts) {
      expect(p.x / cs.width).toBeLessThanOrEqual(1)
      expect(p.y / cs.height).toBeLessThanOrEqual(1)
    }
    const uv = pts.map((p) => [p.x / cs.width, p.y / cs.height])
    const xs = uv.map((q) => q[0]), ys = uv.map((q) => q[1])
    expect(Math.max(...xs)).toBeCloseTo(0.4, 6)
    expect(Math.max(...ys)).toBeCloseTo(0.4, 6)
  })
})

describe('circle', () => {
  it('emits 49 points', () => {
    expect(shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(49)
  })

  it('without canvasSize: rx==ry (pixel-equal circle, may look oval when normalised onto non-square canvas)', () => {
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 50, y: 50 }, { x: 150, y: 50 })
    for (const p of pts) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(100, 6)
    }
  })

  it('with a square canvas, canvasSize has no effect (rx == ry)', () => {
    const cs = { width: 500, height: 500 }
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 50, y: 50 }, { x: 150, y: 50 }, cs)
    for (const p of pts) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(100, 6)
    }
  })

  it('with a 2:1 canvas, normalised u/v radii are equal (true circle on physical surface)', () => {
    const cs = { width: 1000, height: 500 }
    const r  = 100
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: r, y: 0 }, cs)
    const r_norm = r / cs.width
    for (const p of pts) {
      const du = p.x / cs.width
      const dv = p.y / cs.height
      expect(Math.hypot(du, dv)).toBeCloseTo(r_norm, 6)
    }
  })

  it('returns to its first point, so it closes', () => {
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: 80, y: 0 })
    expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x, 6)
    expect(pts[0].y).toBeCloseTo(pts[pts.length - 1].y, 6)
    expect(isClosedRing(pts)).toBe(true)
  })

  it('uses the drag distance as rx (pixel radius in X direction)', () => {
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: 30, y: 40 })
    expect(pts[0].x).toBeCloseTo(50, 6)
  })

  it('collapses to the start point on a zero-size drag', () => {
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 7, y: 7 }, { x: 7, y: 7 })
    expect(pts.every((p) => p.x === 7 && p.y === 7)).toBe(true)
  })
})

describe('isClosedRing', () => {
  it('rejects a single point', () => {
    expect(isClosedRing([{ x: 1, y: 1 }])).toBe(false)
  })

  it('rejects an open polyline whose ends are far apart', () => {
    expect(isClosedRing([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(false)
  })

  it('accepts ends that coincide within the reporting precision', () => {
    expect(isClosedRing([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0.00001, y: -0.00001 }])).toBe(true)
  })
})