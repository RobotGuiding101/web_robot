// Decides whether the experiment report may be downloaded.
//
// The backend can only say whether ANY test point exists (`complete` /
// `missing`); the canonical five Grid Mapping positions live in the Draw
// page, so the gate needs both. Kept free of React so it can be unit tested
// directly — on 2026-10-05 a report went out with `test_points: []` and
// nothing on screen said the download was incomplete.
//
// Points are read from the report payload rather than component state so the
// gate still works after a page reload, when the state is empty but the
// backend still holds the measurements.

export const POSITION_TOLERANCE = 0.005

export const MISSING_LABELS = {
  grid_not_marked: 'สอนกริดไม่ครบทุกมุม',
  no_test_points: 'ยังไม่ได้บันทึกจุดทดสอบ',
  no_draw_stats: 'ยังไม่ได้สั่งวาด',
  grid_changed_since_test: 'สอนกริดใหม่หลังบันทึกจุดทดสอบ — ค่าที่วัดไว้ใช้ไม่ได้',
}

// The server rounds u/v to 4 decimals before storing them, so a point measured
// exactly on target can come back 5e-5 away, and 0.5 + 0.005 is not exactly
// 0.505 in binary floating point. Without the slack, a point sitting precisely
// on the tolerance falls on the wrong side of the comparison.
const FLOAT_SLACK = 1e-9

const near = (a, b) => Math.abs(a - b) <= POSITION_TOLERANCE + FLOAT_SLACK

export function matchRecordedPositions(positions, testPoints) {
  const list = Array.isArray(positions) ? positions : []
  const points = Array.isArray(testPoints) ? testPoints : []
  const matched = list.map((p) =>
    points.some((t) => near(t?.u, p?.u) && near(t?.v, p?.v))
  )
  return {
    matched,
    matchedCount: matched.filter(Boolean).length,
    missingLabels: list.filter((_, i) => !matched[i]).map((p) => p?.label ?? ''),
  }
}

export function evaluateReportGate({ report, positions } = {}) {
  const sheet05 = report?.sheet_05_grid_mapping ?? {}
  const serverCodes = Array.isArray(report?.missing) ? report.missing : []
  const serverComplete = report?.complete === true && serverCodes.length === 0
  // The report ships the very list do_verify_grid() walks, so prefer it over
  // any caller-side copy: two lists would let the gate demand a position the
  // verifier never visits, and the run would be unfinishable.
  const list = Array.isArray(sheet05.test_positions) && sheet05.test_positions.length
    ? sheet05.test_positions
    : positions
  const coverage = matchRecordedPositions(list, sheet05.test_points)

  const reasons = []
  if (!serverComplete) {
    if (serverCodes.length === 0) {
      reasons.push('รายงานยังไม่ครบ')
    } else {
      serverCodes.forEach((code) => reasons.push(MISSING_LABELS[code] || String(code)))
    }
  }
  if (coverage.missingLabels.length > 0) {
    reasons.push(`ยังไม่ได้บันทึกจุดทดสอบ: ${coverage.missingLabels.join(', ')}`)
  }

  return { canDownload: reasons.length === 0, reasons, coverage }
}

// Fabric object type -> the tool name planegrid._stroke_path() branches on.
// Reporting every stroke as "pen" made that branch dead code, so a shape
// like the 49-point circle would reach simplify_stroke()'s Douglas-Peucker
// and come back visibly faceted. Unknown shapes fall back to a non-pen tool
// because skipping simplification is always the safe direction.
export function backendToolFor(obj) {
  if (obj?.type === 'line') return 'line'
  if (obj?.type === 'polyline') {
    return { rectangle: 'rect', triangle: 'triangle', circle: 'circle', line: 'line' }[obj.intendedTool] || 'rect'
  }
  return 'pen'
}