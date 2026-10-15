// Turns the Robot Log panel's raw controller traffic into something an
// operator can read at a glance.
//
// The panel is fed straight from the TCP conversation with the Dobot
// controller, so every line looks like
//   "Send to 192.168.10.110:30003: MovL(-42.8,-386.9,144.9,-179.3,0.1,178.9)"
// which says nothing about what the robot was actually being asked to do.
// Translation happens here rather than in the backend so the untouched line
// survives for debugging — it is kept as `raw` and shown on hover.

const PORT_ROLES = {
  29999: 'dashboard',
  30003: 'motion',
}

// command name -> how to describe it. Anything missing falls through to a
// generic prettifier, so a command added to the SDK later still reads better
// than the raw string instead of being dropped.
const COMMANDS = {
  MovL: (a) => `Move to ${xyz(a, 0)}`,
  RelMovL: (a) => `Move by ${xyz(a, 0)}`,
  RelMovLUser: (a) => `Move by ${xyz(a, 0)} (user frame)`,
  RelMovLTool: (a) => `Jog by ${xyz(a, 0)}`,
  ServoJ: (a) => `Joint-space move to ${nums(a)}°`,
  ServoP: (a) => `Stream move to ${xyz(a, 0)}`,
  GetAngle: () => 'Read joint angles',
  GetPose: () => 'Read TCP position',
  GetRobotMode: () => 'Read operating mode',
  GetErrorID: () => 'Read error status',
  ClearError: () => 'Clear errors',
  ResetRobot: () => 'Stop program and reset',
  EmergencyStop: () => 'EMERGENCY STOP',
  SpeedFactor: (a) => `Set speed to ${num(a[0])}%`,
  CP: (a) => `Set corner rounding to ${num(a[0])}`,
  SetCP: (a) => `Set corner rounding to ${num(a[0])}`,
  Tool: (a) => `Select tool ${num(a[0])}`,
  User: (a) => `Select user frame ${num(a[0])}`,
  ToolCoord: (a) => `Set tool coordinate system to ${num(a[0])}`,
  UserCoord: (a) => `Set user coordinate system to ${num(a[0])}`,
  SetCollisionLevel: (a) => `Set collision sensitivity to ${num(a[0])}`,
  Sync: () => 'Synchronise (no movement)',
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : v)

const nums = (a) => a.map(num).join(', ')

const xyz = (a, i) => {
  const labels = ['X', 'Y', 'Z']
  const pos = labels.map((l, k) => `${l} ${num(a[i + k])}`).join(', ')
  const rot = a.length >= 6 && a.slice(3, 6).every((v) => Number.isFinite(Number(v)))
    ? `  ·  RX ${num(a[3])}° RY ${num(a[4])}° RZ ${num(a[5])}°`
    : ''
  return `${pos} mm${rot}`
}

// A reply is almost always a bare status code. ErrorID 0 means "no error",
// which reads very differently from "ErrorID: 0" when you are trying to work
// out whether the arm is in trouble.
function describeReply(reply) {
  const err = reply.match(/ErrorID\s*[:=]\s*(-?\d+)/i)
  if (err) {
    return Number(err[1]) === 0
      ? { text: 'Controller: no error', kind: 'ok' }
      : { text: `CONTROLLER ERROR ${err[1]} — check the controller`, kind: 'error' }
  }
  const mode = reply.match(/RobotMode\s*[:=]\s*(-?\d+)/i)
  if (mode) return { text: `Operating mode ${mode[1]}`, kind: 'recv' }
  return { text: reply.trim(), kind: 'recv' }
}

export function humaniseRobotLog(raw) {
  const line = String(raw ?? '')
  const m = line.match(/^(Send to|Receive from)\s+([^:]+):(\d+):\s*([\s\S]*)$/)
  if (!m) return { text: line, kind: 'raw', raw: line }

  const [, direction, host, port, body] = m
  const role = PORT_ROLES[port] || `port ${port}`

  if (direction === 'Receive from') {
    const reply = describeReply(body)
    return { text: reply.text, kind: reply.kind, raw: line }
  }

  const cmd = body.match(/^\s*([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?\s*$/)
  if (!cmd) return { text: body.trim(), kind: 'send', raw: line }

  const [, name, argText = ''] = cmd
  const args = argText.trim() === '' ? [] : argText.split(',').map((s) => s.trim())
  const describe = COMMANDS[name]
  const text = describe
    ? describe(args)
    : // Unknown command: keep it verbatim but spaced out so a long argument
      // list is at least legible.
      `${name}${args.length ? ` ${args.join(', ')}` : ''}`

  return { text, kind: 'send', role, raw: line }
}

export function formatRobotLogLines(entries) {
  return entries.map((e) => ({
    t: e.t || '',
    ...humaniseRobotLog(e.msg || e),
  }))
}