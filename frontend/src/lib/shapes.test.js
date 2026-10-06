// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { shapePoints, isClosedRing, SHAPE_TOOLS } from './shapes'

const at = (pts) => pts.map((p) => [p.x, p.y])

describe('rectangle', () => {
  it('emits five points — four corners plus the closing repeat', () => {
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 })
    expect(at(pts)).toEqual([[10, 20], [110, 20], [110, 220], [10, 220], [10, 20]])
  })

  it('normalises a drag that runs right-to-left or upwards', () => {
    const fwd = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 10, y: 20 }, { x: 110, y: 220 })
    const rev = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 110, y: 220 }, { x: 10, y: 20 })
    expect(at(rev)).toEqual(at(fwd))
  })

  it('is a closed ring', () => {
    expect(isClosedRing(shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 0, y: 0 }, { x: 50, y: 50 }))).toBe(true)
  })

  it('collapses to a point when the drag has no size', () => {
    // Not rejected here — the caller decides whether a zero-size shape is
    // worth keeping, but it must not throw or produce NaN coordinates.
    const pts = shapePoints(SHAPE_TOOLS.RECTANGLE, { x: 30, y: 30 }, { x: 30, y: 30 })
    expect(at(pts)).toEqual([[30, 30], [30, 30], [30, 30], [30, 30], [30, 30]])
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('triangle', () => {
  it('puts the apex at the top centre and the base along the bottom', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 })
    expect(at(pts)).toEqual([[50, 0], [100, 100], [0, 100], [50, 0]])
  })

  it('emits four points — three corners plus the closing repeat', () => {
    expect(shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 80, y: 60 })).toHaveLength(4)
  })

  it('is a closed ring', () => {
    expect(isClosedRing(shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 5, y: 5 }, { x: 95, y: 85 }))).toBe(true)
  })

  it('normalises a reversed drag', () => {
    const fwd = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 })
    const rev = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 100, y: 100 }, { x: 0, y: 0 })
    expect(at(rev)).toEqual(at(fwd))
  })

  it('has three distinct corners before the repeat', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 0, y: 0 }, { x: 100, y: 100 })
    const unique = new Set(at(pts.slice(0, 3)).map(String))
    expect(unique.size).toBe(3)
  })

  it('is symmetric about the vertical centre line', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 20, y: 0 }, { x: 80, y: 100 })
    // base corners must sit the same distance either side of the apex x
    expect(pts[1].x - pts[0].x).toBeCloseTo(pts[0].x - pts[2].x)
  })

  it('survives a zero-size drag without NaN', () => {
    const pts = shapePoints(SHAPE_TOOLS.TRIANGLE, { x: 12, y: 12 }, { x: 12, y: 12 })
    expect(at(pts)).toEqual([[12, 12], [12, 12], [12, 12], [12, 12]])
  })
})

describe('circle', () => {
  it('emits 49 points', () => {
    expect(shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(49)
  })

  it('is centred on the drag start with the drag distance as radius', () => {
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 50, y: 50 }, { x: 150, y: 50 })
    for (const p of pts) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(100, 6)
    }
  })

  it('returns to its first point, so it closes', () => {
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: 80, y: 0 })
    expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x, 6)
    expect(pts[0].y).toBeCloseTo(pts[pts.length - 1].y, 6)
    expect(isClosedRing(pts)).toBe(true)
  })

  it('uses the drag distance, not its components, as the radius', () => {
    // Dragging diagonally by (30,40) is a 50mm circle, not a 30mm one.
    const pts = shapePoints(SHAPE_TOOLS.CIRCLE, { x: 0, y: 0 }, { x: 30, y: 40 })
    expect(Math.hypot(pts[0].x, pts[0].y)).toBeCloseTo(50, 6)
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