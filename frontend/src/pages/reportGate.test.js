import { describe, it, expect } from 'vitest'
import {
  evaluateReportGate,
  matchRecordedPositions,
  backendToolFor,
  POSITION_TOLERANCE,
} from './reportGate'

const POSITIONS = [
  { u: 0.25, v: 0.5, label: 'ซ้ายกลาง' },
  { u: 0.5, v: 0.25, label: 'บนกลาง' },
  { u: 0.5, v: 0.5, label: 'กลาง' },
  { u: 0.5, v: 0.75, label: 'ล่างกลาง' },
  { u: 0.75, v: 0.5, label: 'ขวากลาง' },
]

const point = (p) => ({ index: 1, u: p.u, v: p.v, error: [0.1, 0.2, 0.3] })

const completeReport = (testPoints = POSITIONS.map(point)) => ({
  complete: true,
  missing: [],
  sheet_05_grid_mapping: { test_points: testPoints },
})

describe('matchRecordedPositions', () => {
  it('matches every position when all are recorded', () => {
    const out = matchRecordedPositions(POSITIONS, POSITIONS.map(point))
    expect(out.matchedCount).toBe(5)
    expect(out.missingLabels).toEqual([])
    expect(out.matched).toEqual([true, true, true, true, true])
  })

  it('names the positions that are still missing', () => {
    const out = matchRecordedPositions(POSITIONS, [point(POSITIONS[0]), point(POSITIONS[2])])
    expect(out.matchedCount).toBe(2)
    expect(out.missingLabels).toEqual(['บนกลาง', 'ล่างกลาง', 'ขวากลาง'])
  })

  it('matches on both axes, not one', () => {
    const out = matchRecordedPositions([{ u: 0.5, v: 0.5, label: 'กลาง' }], [
      { u: 0.25, v: 0.5 }, { u: 0.5, v: 0.25 },
    ])
    expect(out.matchedCount).toBe(0)
  })

  it('accepts a point inside the tolerance', () => {
    const out = matchRecordedPositions([{ u: 0.5, v: 0.5, label: 'กลาง' }], [
      { u: 0.5 + POSITION_TOLERANCE / 2, v: 0.5 - POSITION_TOLERANCE / 2 },
    ])
    expect(out.matchedCount).toBe(1)
  })

  it('accepts a point exactly on the tolerance boundary', () => {
    const out = matchRecordedPositions([{ u: 0.5, v: 0.5, label: 'กลาง' }], [
      { u: 0.5 + POSITION_TOLERANCE, v: 0.5 },
    ])
    expect(out.matchedCount).toBe(1)
  })

  it('rejects a point just outside the tolerance', () => {
    const out = matchRecordedPositions([{ u: 0.5, v: 0.5, label: 'กลาง' }], [
      { u: 0.5 + POSITION_TOLERANCE * 2, v: 0.5 },
    ])
    expect(out.matchedCount).toBe(0)
  })

  it('survives an empty or malformed payload', () => {
    expect(matchRecordedPositions(POSITIONS, undefined).matchedCount).toBe(0)
    expect(matchRecordedPositions(undefined, POSITIONS.map(point)).matchedCount).toBe(0)
    expect(matchRecordedPositions(POSITIONS, [{}]).matchedCount).toBe(0)
  })
})

describe('evaluateReportGate', () => {
  it('prefers the position list shipped in the report over the caller copy', () => {
    // The verifier walks the server's list. If the gate used a caller-side
    // copy the two could diverge and the run would be unfinishable.
    const report = {
      complete: true,
      missing: [],
      sheet_05_grid_mapping: {
        test_points: POSITIONS.map(point),
        test_positions: [{ u: 0.1, v: 0.1, label: 'only-this-one' }],
      },
    }
    const out = evaluateReportGate({ report, positions: POSITIONS })
    expect(out.coverage.matchedCount).toBe(0)
    expect(out.canDownload).toBe(false)
  })

  it('falls back to the caller list when the server ships none', () => {
    const out = evaluateReportGate({ report: completeReport(), positions: POSITIONS })
    expect(out.canDownload).toBe(true)
  })

  it('allows the download when the server and the coverage both pass', () => {
    const out = evaluateReportGate({ report: completeReport(), positions: POSITIONS })
    expect(out.canDownload).toBe(true)
    expect(out.reasons).toEqual([])
  })

  it.each([
    ['grid_not_marked', 'สอนกริดไม่ครบทุกมุม'],
    ['no_test_points', 'ยังไม่ได้บันทึกจุดทดสอบ'],
    ['no_draw_stats', 'ยังไม่ได้สั่งวาด'],
    ['grid_changed_since_test', 'สอนกริดใหม่หลังบันทึกจุดทดสอบ — ค่าที่วัดไว้ใช้ไม่ได้'],
  ])('blocks on the %s code and names it in Thai', (code, label) => {
    const out = evaluateReportGate({
      report: { complete: false, missing: [code], sheet_05_grid_mapping: { test_points: POSITIONS.map(point) } },
      positions: POSITIONS,
    })
    expect(out.canDownload).toBe(false)
    expect(out.reasons).toContain(label)
  })

  it('blocks when the server claims complete but a position was never measured', () => {
    const out = evaluateReportGate({
      report: completeReport(POSITIONS.slice(0, 4).map(point)),
      positions: POSITIONS,
    })
    expect(out.canDownload).toBe(false)
    expect(out.reasons.join(' ')).toContain('ขวากลาง')
  })

  it('blocks on the exact 2026-10-05 capture: empty test_points', () => {
    const out = evaluateReportGate({
      report: {
        complete: false,
        missing: ['no_test_points'],
        sheet_05_grid_mapping: { test_points: [] },
      },
      positions: POSITIONS,
    })
    expect(out.canDownload).toBe(false)
    expect(out.coverage.matchedCount).toBe(0)
  })

  it('does not trust complete:true while missing is non-empty', () => {
    const out = evaluateReportGate({
      report: { complete: true, missing: ['no_draw_stats'], sheet_05_grid_mapping: { test_points: POSITIONS.map(point) } },
      positions: POSITIONS,
    })
    expect(out.canDownload).toBe(false)
    expect(out.reasons).toContain('ยังไม่ได้สั่งวาด')
  })

  it('does not trust an empty missing array on an incomplete report', () => {
    const out = evaluateReportGate({ report: { complete: false, missing: [] }, positions: [] })
    expect(out.canDownload).toBe(false)
    expect(out.reasons).toContain('รายงานยังไม่ครบ')
  })

  it('passes an unknown code through rather than silently allowing it', () => {
    const out = evaluateReportGate({
      report: { complete: false, missing: ['something_new'], sheet_05_grid_mapping: {} },
      positions: [],
    })
    expect(out.canDownload).toBe(false)
    expect(out.reasons).toContain('something_new')
  })

  it('reports both server and coverage problems together', () => {
    const out = evaluateReportGate({
      report: { complete: false, missing: ['no_draw_stats'], sheet_05_grid_mapping: { test_points: [] } },
      positions: POSITIONS,
    })
    expect(out.reasons.length).toBe(2)
  })

  it('reads points from the payload so it survives a page reload', () => {
    const out = evaluateReportGate({ report: completeReport(), positions: POSITIONS })
    expect(out.coverage.matchedCount).toBe(5)
  })

  it('blocks on a null report instead of throwing', () => {
    const out = evaluateReportGate({ report: null, positions: POSITIONS })
    expect(out.canDownload).toBe(false)
  })
})

describe('backendToolFor', () => {
  it('reports a freehand path as pen', () => {
    expect(backendToolFor({ type: 'path' })).toBe('pen')
  })

  it('reports a line as line', () => {
    expect(backendToolFor({ type: 'line' })).toBe('line')
  })

  it('maps the canvas shape tools onto the backend names', () => {
    expect(backendToolFor({ type: 'polyline', intendedTool: 'rectangle' })).toBe('rect')
    expect(backendToolFor({ type: 'polyline', intendedTool: 'circle' })).toBe('circle')
  })

  it('never falls back to pen for a polyline, so no shape gets simplified', () => {
    expect(backendToolFor({ type: 'polyline' })).toBe('rect')
    expect(backendToolFor({ type: 'polyline', intendedTool: 'nonsense' })).toBe('rect')
  })

  it('defaults to pen for an unknown object', () => {
    expect(backendToolFor(undefined)).toBe('pen')
    expect(backendToolFor({})).toBe('pen')
  })
})