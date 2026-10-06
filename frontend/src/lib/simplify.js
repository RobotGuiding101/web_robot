/**
 * Douglas-Peucker (Ramer-Douglas-Peucker) polyline simplification algorithm.
 *
 * Used in DrawingModePage to reduce dense freehand pen strokes before
 * sending to the robot arm or directly on the canvas.
 */

/**
 * Calculates perpendicular distance from point p to line segment between a and b.
 * Supports both { x, y } objects and [x, y] tuples.
 *
 * @param {{x: number, y: number}|number[]} p
 * @param {{x: number, y: number}|number[]} a
 * @param {{x: number, y: number}|number[]} b
 * @returns {number} Distance in same units as inputs.
 */
export function pointToSegmentDist(p, a, b) {
  const px = Array.isArray(p) ? p[0] : p.x
  const py = Array.isArray(p) ? p[1] : p.y
  const ax = Array.isArray(a) ? a[0] : a.x
  const ay = Array.isArray(a) ? a[1] : a.y
  const bx = Array.isArray(b) ? b[0] : b.x
  const by = Array.isArray(b) ? b[1] : b.y

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay)
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const projX = ax + t * dx
  const projY = ay + t * dy

  return Math.hypot(px - projX, py - projY)
}

/**
 * Ramer-Douglas-Peucker algorithm.
 * Recursively removes points whose distance to the chord is <= epsilon.
 *
 * @param {Array<{x: number, y: number}|number[]>} points
 * @param {number} epsilon - Threshold distance. If <= 0, points are returned as-is.
 * @returns {Array<{x: number, y: number}|number[]>} Simplified points array.
 */
export function douglasPeucker(points, epsilon) {
  if (!Array.isArray(points) || points.length <= 2 || !epsilon || epsilon <= 0) {
    return points ? [...points] : []
  }

  let maxDist = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDist(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon)
    const right = douglasPeucker(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }

  return [first, last]
}

/**
 * Maps a percentage (0 - 100%) to an epsilon pixel threshold.
 *
 * At 0%: epsilon = 0 (no simplification).
 * At 10%: epsilon ≈ 1.2px (eliminates micro-jitter/hand tremors).
 * At 50%: epsilon ≈ 15.8px (moderate smoothing).
 * At 100%: epsilon ≈ 48px (heavy reduction to principal vertices).
 *
 * @param {number} percentage - Slider percentage 0..100
 * @param {{ width?: number, height?: number }} [canvasSize]
 * @returns {number} Epsilon in pixels
 */
export function pctToEpsilon(percentage, canvasSize = { width: 800, height: 600 }) {
  const pct = Math.max(0, Math.min(100, Number(percentage) || 0))
  if (pct === 0) return 0

  const dim = Math.min(canvasSize.width || 800, canvasSize.height || 600)
  const maxEps = dim * 0.08
  const factor = Math.pow(pct / 100, 1.6)
  return factor * maxEps
}

/**
 * Simplifies a polyline or path points array based on a percentage (0 - 100%).
 *
 * @param {Array<{x: number, y: number}|number[]>} points
 * @param {number} percentage - 0 to 100
 * @param {{ width?: number, height?: number }} [canvasSize]
 * @returns {Array<{x: number, y: number}|number[]>}
 */
export function simplifyByPercentage(points, percentage, canvasSize) {
  if (!Array.isArray(points) || points.length <= 2 || !percentage || percentage <= 0) {
    return points ? [...points] : []
  }
  const eps = pctToEpsilon(percentage, canvasSize)
  return douglasPeucker(points, eps)
}
