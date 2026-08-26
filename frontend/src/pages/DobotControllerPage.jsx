import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const STEP_VALUES = [0.1, 1, 5, 10]
const CARTESIAN_AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ']
const JOINT_AXES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']
const LOG_MAX = 200

// ── Jog Button Group ──────────────────────────────────────────────────────────
const JogGroup = ({ axes, onMove }) => (
  <div className="jog-panel">
    {axes.map((axis) => (
      <div key={axis} className="jog-row">
        <button
          id={`jog-${axis}-minus`}
          className="jog-pill jog-pill--minus"
          onClick={() => onMove(axis, '-')}
          title={`Decrease ${axis}`}
        >
          <span className="jog-axis-badge">{axis}</span>
          <span className="jog-sign">-</span>
        </button>
        <button
          id={`jog-${axis}-plus`}
          className="jog-pill jog-pill--plus"
          onClick={() => onMove(axis, '+')}
          title={`Increase ${axis}`}
        >
          <span className="jog-axis-badge">{axis}</span>
          <span className="jog-sign">+</span>
        </button>
      </div>
    ))}
  </div>
)

// ── Log Panel ─────────────────────────────────────────────────────────────────
const LogPanel = ({ title, channel, accentClass }) => {
  const [lines, setLines] = useState([])
  const [paused, setPaused] = useState(false)
  const bottomRef = useRef(null)
  const pausedRef = useRef(false)
  const pendingRef = useRef([])

  pausedRef.current = paused

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, paused])

  useEffect(() => {
    let ws = null
    let dead = false

    const addLine = (entry) => {
      if (pausedRef.current) { pendingRef.current.push(entry); return }
      setLines((prev) => {
        const next = [...prev, entry]
        return next.length > LOG_MAX ? next.slice(-LOG_MAX) : next
      })
    }

    fetch(`/api/robot/log/${channel}`)
      .then((r) => r.json())
      .then((data) => { if (!dead && Array.isArray(data.lines)) setLines(data.lines) })
      .catch(() => { })

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${window.location.host}/api/robot/ws/log/${channel}`)
    ws.onmessage = (ev) => { try { addLine(JSON.parse(ev.data)) } catch { } }
    ws.onerror = () => { }

    return () => { dead = true; ws?.close() }
  }, [channel])

  const handleResume = useCallback(() => {
    setPaused(false)
    if (pendingRef.current.length) {
      setLines((prev) => {
        const next = [...prev, ...pendingRef.current]
        pendingRef.current = []
        return next.length > LOG_MAX ? next.slice(-LOG_MAX) : next
      })
    }
  }, [])

  const handleClear = useCallback(() => {
    setLines([])
    pendingRef.current = []
  }, [])

  return (
    <div className={`log-panel-box ${accentClass}`}>
      <div className="log-panel-header">
        <span className="log-panel-title">{title}</span>
        <div className="log-panel-actions">
          {paused
            ? <button className="log-btn log-btn--resume" onClick={handleResume}>▶ Resume</button>
            : <button className="log-btn log-btn--pause" onClick={() => setPaused(true)}>⏸ Pause</button>
          }
          <button className="log-btn log-btn--clear" onClick={handleClear}>✕ Clear</button>
        </div>
      </div>
      <div className="log-panel-body" id={`log-${channel}`}>
        {lines.length === 0
          ? <span className="log-empty">No log entries yet…</span>
          : lines.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-time">{l.t}</span>
              <span className="log-msg">{l.msg}</span>
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
      {paused && pendingRef.current.length > 0 && (
        <div className="log-paused-banner">
          ⏸ Paused — {pendingRef.current.length} new line{pendingRef.current.length > 1 ? 's' : ''} waiting
        </div>
      )}
    </div>
  )
}

// ── Section header (compact reusable) ─────────────────────────────────────────
const SectionHead = ({ children }) => (
  <div className="ctrl-section-head">{children}</div>
)

// ── Main Page ─────────────────────────────────────────────────────────────────
const DobotControllerPage = () => {
  // ── Jog / position state ──────────────────────────────────────────────────
  const [stepValue, setStepValue] = useState(1)
  const [pos, setPos] = useState({ X: 0, Y: 0, Z: 150, RX: 0, RY: 0, RZ: 0 })
  const [joints, setJoints] = useState({ J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 })
  const [lastMoved, setLastMoved] = useState(null)

  // ── Init ──────────────────────────────────────────────────────────────────
  const [initLoading, setInitLoading] = useState(false)
  const [initStatus, setInitStatus] = useState(null) // 'ok' | 'error' | null

  // ── Stable cache-buster: สร้างครั้งเดียวตอน mount ไม่โหลดซ้ำทุก re-render ──
  const viewerKey = useRef(Date.now())

  // ── 3D viewer sync ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleMessage = (e) => {
      if (!e.data || e.data.type !== 'tcpUpdate') return
      const { x, y, z, rx, ry, rz, joints: j } = e.data
      setPos((prev) => ({
        ...prev,
        X: x ?? prev.X, Y: y ?? prev.Y, Z: z ?? prev.Z,
        RX: rx ?? prev.RX, RY: ry ?? prev.RY, RZ: rz ?? prev.RZ,
      }))
      if (Array.isArray(j) && j.length === 6)
        setJoints({ J1: j[0], J2: j[1], J3: j[2], J4: j[3], J5: j[4], J6: j[5] })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleEmergency = () => {
    fetch('/api/robot/emergency-stop', { method: 'POST' }).catch(() => { })
    alert('EMERGENCY STOP!')
  }

  const handleInit = async () => {
    if (initLoading) return
    setInitLoading(true); setInitStatus(null)
    try {
      const res = await fetch('/api/robot/init', { method: 'POST' })
      if (!res.ok) throw new Error()
      setInitStatus('ok')
      setPos({ X: 0, Y: 0, Z: 150, RX: 0, RY: 0, RZ: 0 })
      setJoints({ J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 })
      setLastMoved('Init (Home)')
    } catch { setInitStatus('error') }
    finally {
      setInitLoading(false)
      setTimeout(() => setInitStatus(null), 3000)
    }
  }

  const handleMove = (axis, direction) => {
    const delta = direction === '+' ? stepValue : -stepValue
    setLastMoved(`${axis}${direction}`)
    if (axis.startsWith('J'))
      setJoints((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    else
      setPos((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Dobot Controller" onEmergency={handleEmergency} />

        <div className="page-content dobot-page">

          {/* ── Top: Viewer + Control Panel side-by-side ── */}
          <div className="dobot-layout">

            {/* Left — 3D Viewer (top) + Robot Log (bottom) */}
            <div className="dobot-left-col">
              <div className="dobot-3d-box">
                <iframe
                  src={`/robot-viewer.html?v=${viewerKey.current}`}
                  title="Robot Arm 3D Viewer"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block', borderRadius: '14px' }}
                  allow="accelerometer"
                />
                <button
                  className="dobot-fullscreen-btn"
                  title="Fullscreen"
                  onClick={() => window.open('/robot-viewer.html', '_blank')}
                >⛶</button>
              </div>
              <div className="dobot-left-log">
                <LogPanel title="Robot Log" channel="robot" accentClass="log-panel-box--robot" />
              </div>
            </div>

            {/* Right — Control Panel */}
            <div className="ctrl-box">

              {/* ── Header ── */}
              <div className="ctrl-box-header">
                <div className="ctrl-box-title-wrap">
                  <span className="ctrl-box-title">Control Panel</span>
                </div>
                <div className="ctrl-box-header-right">
                  {lastMoved && (
                    <span className="ctrl-last-action">Last: <strong>{lastMoved}</strong></span>
                  )}
                  <button
                    id="btn-init-home"
                    className={`init-btn${initLoading ? ' init-btn--loading' : ''}${initStatus === 'ok' ? ' init-btn--ok' : ''}${initStatus === 'error' ? ' init-btn--error' : ''}`}
                    onClick={handleInit}
                    disabled={initLoading}
                    title="Send robot to Home position"
                  >
                    {initLoading ? <><span className="init-btn-spinner" /> Homing…</>
                      : initStatus === 'ok' ? <>✓ Homed</>
                        : initStatus === 'error' ? <>✗ Error</>
                          : <>⌂ Init</>}
                  </button>
                </div>
              </div>

              {/* ── Coordinate Readout ── */}
              <div className="coord-bar">
                <div className="coord-group">
                  <div className="coord-group-header">
                    <span className="coord-group-dot coord-group-dot--cartesian" />
                    <span className="coord-group-label">Cartesian (mm / deg)</span>
                  </div>
                  <div className="coord-items">
                    {Object.entries(pos).map(([k, v]) => (
                      <div key={k} className="coord-item">
                        <span className="coord-axis">{k}</span>
                        <span className="coord-val">{v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="coord-group">
                  <div className="coord-group-header">
                    <span className="coord-group-dot coord-group-dot--joint" />
                    <span className="coord-group-label">Joint Angles (deg)</span>
                  </div>
                  <div className="coord-items">
                    {Object.entries(joints).map(([k, v]) => (
                      <div key={k} className="coord-item">
                        <span className="coord-axis">{k}</span>
                        <span className="coord-val">{v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Step Value ── */}
              <div className="step-row">
                <div className="step-row-label-wrap">
                  <span className="step-row-label">Step</span>
                  <span className="step-row-sub">per jog</span>
                </div>
                <div className="step-pills-wrap">
                  {STEP_VALUES.map((val) => (
                    <button
                      key={val}
                      className={`step-pill ${stepValue === val ? 'active' : ''}`}
                      onClick={() => setStepValue(val)}
                    >{val}</button>
                  ))}
                </div>
              </div>

              {/* ── Jog Panels ── */}
              <div className="jog-dual">
                <div className="jog-box">
                  <div className="jog-box-header"><span className="jog-box-title">Cartesian</span></div>
                  <JogGroup axes={CARTESIAN_AXES} onMove={handleMove} />
                </div>
                <div className="jog-box">
                  <div className="jog-box-header"><span className="jog-box-title">Joint</span></div>
                  <JogGroup axes={JOINT_AXES} onMove={handleMove} />
                </div>
              </div>

            </div>{/* end ctrl-box */}
          </div>{/* end dobot-layout */}

        </div>{/* end dobot-page */}
      </div>
    </div>
  )
}

export default DobotControllerPage
