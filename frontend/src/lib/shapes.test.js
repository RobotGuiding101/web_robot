// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { shapePoints, isClosedRing, SHAPE_TOOLS } from './shapes'

const at = (pts) => pts.map((p) => [p.x, p.y])

// CORNER_DWELL = 3 → each corner repeated 3×, then one closing point.
// rectangle: 4 corners × 3 + 1 closing = 13 points total
// triangle:  3 corners × 3 + 1 closing = 10 points total
const DWELL = 3

describe('rectangle', () => {
  it('has 4*DWELL+1 points (corner dwell + closing repeat)', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 })
    expect(pts).toHaveLength(4 * DWELL + 1)
  })

  it('contains the four corners in TL→TR→BR→BL order with closing TL', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 })
    expect([pts[0].x, pts[0].y]).toEqual([10, 20])          // TL dwell[0]
    expect([pts[DWELL].x, pts[DWELL].y]).toEqual([110, 20])     // TR dwell[0]
    expect([pts[2*DWELL].x, pts[2*DWELL].y]).toEqual([110, 220]) // BR dwell[0]
    expect([pts[3*DWELL].x, pts[3*DWELL].y]).toEqual([10, 220])  // BL dwell[0]
    expect([pts[4*DWELL].x, pts[4*DWELL].y]).toEqual([10, 20])   // closing
  })

  it('normalises a drag that runs right-to-left or upwards', () => {
    const fwd = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 })
    const rev = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 110, y: 220 }, { x: 10, y: 20 })
    expect(at(rev)).toEqual(at(fwd))
  })

  it('is a closed ring', () => {
    expect(isClosedRing(shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 50, y: 50 }))).toBe(true)
  })

  it('collapses to a point when the drag has no size — all coords finite', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 30, y: 30 }, { x: 30, y: 30 })
    expect(pts).toHaveLength(4 * DWELL + 1)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(pts.every((p) => p.x === 30 && p.y === 30)).toBe(true)
  })
})

describe('triangle', () => {
  it('has 3*DWELL+1 points (corner dwell + closing repeat)', () => {
    expect(shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 80, y: 60 })).toHaveLength(3 * DWELL + 1)
  })

  it('puts the apex at the top centre and the base along the bottom', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 })
    expect([pts[0].x, pts[0].y]).toEqual([50, 0])          // apex dwell[0]
    expect([pts[DWELL].x, pts[DWELL].y]).toEqual([100, 100])   // BR dwell[0]
    expect([pts[2*DWELL].x, pts[2*DWELL].y]).toEqual([0, 100]) // BL dwell[0]
    expect([pts[3*DWELL].x, pts[3*DWELL].y]).toEqual([50, 0])  // closing
  })

  it('is a closed ring', () => {
    expect(isClosedRing(shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 5, y: 5 }, { x: 95, y: 85 }))).toBe(true)
  })

  it('normalises a reversed drag', () => {
    const fwd = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 })
    const rev = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 100, y: 100 }, { x: 0, y: 0 })
    expect(at(rev)).toEqual(at(fwd))
  })

  it('has three distinct corner positions', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 })
    const corners = [pts[0], pts[DWELL], pts[2*DWELL]]
    const unique = new Set(corners.map((p) => `${p.x},${p.y}`))
    expect(unique.size).toBe(3)
  })

  it('is symmetric about the vertical centre line', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 20, y: 0 }, { x: 80, y: 100 })
    const apex  = pts[0]
    const right = pts[DWELL]
    const left  = pts[2*DWELL]
    expect(right.x - apex.x).toBeCloseTo(apex.x - left.x)
  })

  it('survives a zero-size drag without NaN', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 12, y: 12 }, { x: 12, y: 12 })
    expect(pts).toHaveLength(3 * DWELL + 1)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
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
    // cw=1000, ch=500 → ry = r*(500/1000) = r*0.5
    // After normalise: Δu = rx/cw = r/cw,  Δv = ry/ch = (r*ch/cw)/ch = r/cw ✓
    const cs = { width: 1000, height: 500 }
    const r  = 100
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: r, y: 0 }, cs)
    const r_norm = r / cs.width  // expected normalised radius = 0.1
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
    // Dragging diagonally by (30,40): radius_px = 50 → at angle=0, x = 0 + cos(0)*50 = 50
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
