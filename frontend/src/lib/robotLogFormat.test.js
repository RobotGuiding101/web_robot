import { describe, it, expect } from 'vitest'
import { humaniseRobotLog, formatRobotLogLines } from './robotLogFormat'

const SEND = 'Send to 192.168.10.110:30003: '
const RECV = 'Receive from 192.168.10.110:30003: '

describe('humaniseRobotLog', () => {
  it('describes a Cartesian move in plain words', () => {
    const out = humaniseRobotLog(`${SEND}MovL(-42.81,-386.86,144.92,-179.27,0.11,178.87)`)
    expect(out.text).toContain('Move to')
    expect(out.text).toContain('X -42.81')
    expect(out.text).toContain('Z 144.92')
    expect(out.text).toContain('mm')
  })

  it('distinguishes a jog from a commanded move', () => {
    expect(humaniseRobotLog(`${SEND}RelMovLTool(-0.1,0,0,0,0,0)`).text).toMatch(/^Jog by/)
  })

  it('turns a zero error code into reassurance, not a bare number', () => {
    const out = humaniseRobotLog(`${RECV}ErrorID:0`)
    expect(out.text).toBe('Controller: no error')
    expect(out.kind).toBe('ok')
  })

  it('shouts about a non-zero error code', () => {
    const out = humaniseRobotLog(`${RECV}ErrorID:-1001`)
    expect(out.kind).toBe('error')
    expect(out.text).toContain('-1001')
    expect(out.text).toMatch(/CONTROLLER ERROR/)
  })

  it('names the parameterless commands', () => {
    expect(humaniseRobotLog(`${SEND}GetAngle()`).text).toBe('Read joint angles')
    expect(humaniseRobotLog(`${SEND}ClearError()`).text).toBe('Clear errors')
    expect(humaniseRobotLog(`${SEND}ResetRobot()`).text).toBe('Stop program and reset')
  })

  it('flags an emergency stop', () => {
    expect(humaniseRobotLog(`${SEND}EmergencyStop()`).text).toBe('EMERGENCY STOP')
  })

  it('keeps an unknown command rather than discarding it', () => {
    const out = humaniseRobotLog(`${SEND}SomeFutureCmd(1,2,3)`)
    expect(out.text).toBe('SomeFutureCmd 1, 2, 3')
  })

  it('always preserves the untouched line for debugging', () => {
    const raw = `${SEND}MovL(-42.81,-386.86,144.92,0,0,0)`
    expect(humaniseRobotLog(raw).raw).toBe(raw)
  })

  it('passes through a line it cannot parse rather than blanking it', () => {
    const out = humaniseRobotLog('something entirely unexpected')
    expect(out.text).toBe('something entirely unexpected')
    expect(out.kind).toBe('raw')
  })

  it('tolerates null and undefined', () => {
    expect(humaniseRobotLog(null).text).toBe('')
    expect(humaniseRobotLog(undefined).kind).toBe('raw')
  })

  it('handles a command with no parentheses', () => {
    expect(humaniseRobotLog(`${SEND}Sync`).text).toBe('Synchronise (no movement)')
  })

  it('labels an unknown port rather than hiding it', () => {
    expect(humaniseRobotLog('Send to 10.0.0.1:30010: Tool(2)').role).toBe('port 30010')
  })
})

describe('formatRobotLogLines', () => {
  it('keeps the timestamp and adds the readable text', () => {
    const out = formatRobotLogLines([{ t: '12:00:01', msg: `${SEND}GetAngle()` }])
    expect(out[0].t).toBe('12:00:01')
    expect(out[0].text).toBe('Read joint angles')
  })

  it('accepts a bare string entry', () => {
    expect(formatRobotLogLines([`${RECV}ErrorID:0`])[0].kind).toBe('ok')
  })
})