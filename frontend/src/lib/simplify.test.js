import { describe, it, expect } from 'vitest'
import {
  pointToSegmentDist,
  douglasPeucker,
  pctToEpsilon,
  simplifyByPercentage,
} from './simplify'

describe('pointToSegmentDist', () => {
  it('handles coincident endpoints', () => {
    const p = { x: 3, y: 4 }
    const a = { x: 0, y: 0 }
    const b = { x: 0, y: 0 }
    expect(pointToSegmentDist(p, a, b)).toBe(5)
  })

  it('calculates perpendicular distance to line segment', () => {
    const p = { x: 5, y: 5 }
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(pointToSegmentDist(p, a, b)).toBe(5)
  })

  it('calculates distance to closest endpoint when outside segment projection', () => {
    const p = { x: -3, y: 4 }
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(pointToSegmentDist(p, a, b)).toBe(5)
  })

  it('supports array tuples [x, y]', () => {
    expect(pointToSegmentDist([5, 5], [0, 0], [10, 0])).toBe(5)
  })
})

describe('douglasPeucker', () => {
  it('returns original points if <= 2 points or epsilon <= 0', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }]
    expect(douglasPeucker(pts, 5)).toEqual(pts)
    expect(douglasPeucker(pts, 0)).toEqual(pts)
    expect(douglasPeucker(pts, -1)).toEqual(pts)
  })

  it('removes collinear points on a straight line', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]
    const simplified = douglasPeucker(pts, 0.1)
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
  })

  it('preserves significant inflection points', () => {
    // V-shape: (0,0) -> (5, 10) -> (10, 0)
    const pts = [
      { x: 0, y: 0 },
      { x: 2.5, y: 5 },
      { x: 5, y: 10 },
      { x: 7.5, y: 5 },
      { x: 10, y: 0 },
    ]
    const simplified = douglasPeucker(pts, 1.0)
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 0 },
    ])
  })

  it('preserves both halves of a triangle when deviation exceeds epsilon', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 0 },
    ]
    expect(douglasPeucker(pts, 2.0).length).toBe(3)
    // When epsilon exceeds peak height, collapses to endpoints
    expect(douglasPeucker(pts, 12.0).length).toBe(2)
  })
})

describe('pctToEpsilon and simplifyByPercentage', () => {
  it('maps 0% to 0 epsilon', () => {
    expect(pctToEpsilon(0)).toBe(0)
  })

  it('scales monotonically from 0 to 100%', () => {
    const eps10 = pctToEpsilon(10)
    const eps50 = pctToEpsilon(50)
    const eps100 = pctToEpsilon(100)

    expect(eps10).toBeGreaterThan(0)
    expect(eps50).toBeGreaterThan(eps10)
    expect(eps100).toBeGreaterThan(eps50)
  })

  it('simplifyByPercentage does not reduce at 0%', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 10, y: 10 },
    ]
    expect(simplifyByPercentage(pts, 0)).toEqual(pts)
  })

  it('simplifyByPercentage simplifies collinear points at > 0%', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 10, y: 10 },
    ]
    const res = simplifyByPercentage(pts, 20)
    expect(res).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
  })
})
