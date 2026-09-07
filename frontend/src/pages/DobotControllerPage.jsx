import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const STEP_VALUES = [0.1, 1, 5, 10, 20]
const CARTESIAN_AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ']
const JOINT_AXES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']
const LOG_MAX = 200
const STATUS_POLL_MS = 1000

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
    let dead = false

    const addLine = (entry) => {
      if (pausedRef.current) { pendingRef.current.push(entry); return }
      setLines((prev) => {
        const next = [...prev, entry]
        return next.length > LOG_MAX ? next.slice(-LOG_MAX) : next
      })
    }

    fetch('/api/map/robot_logs')
      .then((r) => r.json())
      .then((data) => {
        if (!dead && Array.isArray(data.entries)) {
          setLines(data.entries.map(e => ({ t: e.t || '', msg: e.msg || e })))
        }
      })
      .catch(() => { })

    const pollInterval = setInterval(() => {
      if (dead || pausedRef.current) return
      fetch('/api/map/robot_logs')
        .then((r) => r.json())
        .then((data) => {
          if (!dead && Array.isArray(data.entries)) {
            setLines(data.entries.map(e => ({ t: e.t || '', msg: e.msg || e })))
          }
        })
        .catch(() => { })
    }, 2000)

    return () => { dead = true; clearInterval(pollInterval) }
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
            ? <button className="log-btn log-btn--resume" onClick={handleResume}>Resume</button>
            : <button className="log-btn log-btn--pause" onClick={() => setPaused(true)}>Pause</button>
          }
          <button className="log-btn log-btn--clear" onClick={handleClear}>Clear</button>
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
          Paused — {pendingRef.current.length} new line{pendingRef.current.length > 1 ? 's' : ''} waiting
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
  const [speed, setSpeed] = useState(10)  // SpeedFactor 1-100%, loaded from DB
  const [pos, setPos] = useState({ X: 0, Y: 0, Z: 150, RX: 0, RY: 0, RZ: 0 })
  const [joints, setJoints] = useState({ J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 })
  const [lastMoved, setLastMoved] = useState(null)

  // ── Action statuses ───────────────────────────────────────────────────────
  const [initLoading, setInitLoading] = useState(false)
  const [initStatus, setInitStatus] = useState(null) // 'ok' | 'error' | null
  const [homeLoading, setHomeLoading] = useState(false)
  const [homeStatus, setHomeStatus] = useState(null)
  const [errorStatus, setErrorStatus] = useState(null)

  // ── Stable cache-buster ──
  const viewerKey = useRef(Date.now())
  const viewerBoxRef = useRef(null)
  const [isViewerFullscreen, setIsViewerFullscreen] = useState(false)

  // ── Auto-connect + init robot on mount ─────────────────────────────────
  useEffect(() => {
    const autoInit = async () => {
      try {
        await fetch('/api/map/connect', { method: 'POST' })
        await fetch('/api/map/camstart', { method: 'POST' })
        await fetch('/api/map/init', { method: 'POST' })
      } catch { /* ignore */ }
    }
    autoInit()
  }, [])

  // ── Load speed from DB settings ───────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('access_token') || ''
    fetch('/api/settings', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.sidebar_speed) setSpeed(Number(data.sidebar_speed))
      })
      .catch(() => {})
  }, [])

  // ── Poll real robot status from /api/map/status ──────────────────────────
  useEffect(() => {
    let dead = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/map/status')
        if (!res.ok || dead) return
        const data = await res.json()
        if (dead) return

        if (Array.isArray(data.pose) && data.pose.length === 6) {
          setPos({
            X: +data.pose[0].toFixed(2),
            Y: +data.pose[1].toFixed(2),
            Z: +data.pose[2].toFixed(2),
            RX: +data.pose[3].toFixed(2),
            RY: +data.pose[4].toFixed(2),
            RZ: +data.pose[5].toFixed(2),
          })
        }

        if (Array.isArray(data.angles) && data.angles.length === 6) {
          setJoints({
            J1: +data.angles[0].toFixed(2),
            J2: +data.angles[1].toFixed(2),
            J3: +data.angles[2].toFixed(2),
            J4: +data.angles[3].toFixed(2),
            J5: +data.angles[4].toFixed(2),
            J6: +data.angles[5].toFixed(2),
          })
        }
      } catch { /* ignore */ }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, STATUS_POLL_MS)
    return () => { dead = true; clearInterval(interval) }
  }, [])

  // ── Sync real robot joints → 3D model iframe ─────────────────────────────
  useEffect(() => {
    const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
    if (!iframe || !iframe.contentWindow) return
    const jArr = [joints.J1, joints.J2, joints.J3, joints.J4, joints.J5, joints.J6]
    iframe.contentWindow.postMessage({ type: 'setJoints', joints: jArr }, '*')
  }, [joints])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleEmergency = () => {
    fetch('/api/map/error', { method: 'POST' }).catch(() => { })
    alert('EMERGENCY STOP!')
  }

  // Track native fullscreen changes
  useEffect(() => {
    const onFsChange = () => setIsViewerFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const handleViewerFullscreen = useCallback(async () => {
    const el = viewerBoxRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen() } catch { /* ignore */ }
    } else {
      try { await document.exitFullscreen() } catch { /* ignore */ }
    }
  }, [])

  const handleClearError = async () => {
    try {
      const res = await fetch('/api/map/error', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setErrorStatus('ok')
        setLastMoved('Clear Error')
      } else {
        setErrorStatus('error')
      }
    } catch {
      setErrorStatus('error')
    } finally {
      setTimeout(() => setErrorStatus(null), 3000)
    }
  }

  const handleInit = async () => {
    if (initLoading) return
    setInitLoading(true); setInitStatus(null)
    try {
      await fetch('/api/map/connect', { method: 'POST' })
      const res = await fetch('/api/map/init', { method: 'POST' })
      if (!res.ok) throw new Error()
      setInitStatus('ok')
      setLastMoved('Init')
    } catch { setInitStatus('error') }
    finally {
      setInitLoading(false)
      setTimeout(() => setInitStatus(null), 3000)
    }
  }

  const handleGoHome = async () => {
    if (homeLoading) return
    setHomeLoading(true); setHomeStatus(null)
    try {
      const res = await fetch('/api/map/home', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Home move failed')
      setHomeStatus('ok')
      setLastMoved('Home')
    } catch {
      setHomeStatus('error')
    } finally {
      setHomeLoading(false)
      setTimeout(() => setHomeStatus(null), 3000)
    }
  }

  const handleMove = (axis, direction) => {
    const delta = direction === '+' ? stepValue : -stepValue
    setLastMoved(`${axis}${direction}`)

    // Send jog command to real robot via /api/map (with speed)
    if (axis.startsWith('J')) {
      const jointNum = parseInt(axis.replace('J', ''))
      fetch('/api/map/jog_joint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joint: jointNum, amount: delta, speed }),
      }).catch(() => { })
      setJoints((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    } else {
      fetch('/api/map/jog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ axis: axis.toLowerCase(), amount: delta, speed }),
      }).catch(() => { })
      setPos((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      <Sidebar onSpeedChange={setSpeed} />
      <div className="main-content">
        <TopBar title="Dobot Controller" onEmergency={handleEmergency} />

        <div className="page-content dobot-page">

          {/* ── Top: Viewer + Control Panel side-by-side ── */}
          <div className="dobot-layout">

            {/* Left — 3D Viewer (top) + Robot Log (bottom) */}
            <div className="dobot-left-col">
              <div ref={viewerBoxRef} className="dobot-3d-box">
                <iframe
                  src={`/robot-viewer.html?v=${viewerKey.current}`}
                  title="Robot Arm 3D Viewer"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block', borderRadius: '14px' }}
                  allow="accelerometer"
                />
                <button
                  className="dobot-fullscreen-btn"
                  title={isViewerFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  onClick={handleViewerFullscreen}
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
                    id="btn-clear-error"
                    className={`init-btn init-btn--secondary${errorStatus === 'ok' ? ' init-btn--ok' : ''}${errorStatus === 'error' ? ' init-btn--error' : ''}`}
                    onClick={handleClearError}
                    title="Clear robot errors and reset alarms (/error)"
                  >
                    {errorStatus === 'ok' ? 'Cleared' : errorStatus === 'error' ? 'Error' : 'Clear Error'}
                  </button>
                  <button
                    id="btn-init-robot"
                    className={`init-btn${initLoading ? ' init-btn--loading' : ''}${initStatus === 'ok' ? ' init-btn--ok' : ''}${initStatus === 'error' ? ' init-btn--error' : ''}`}
                    onClick={handleInit}
                    disabled={initLoading}
                    title="Connect and initialize / enable robot motors (/init)"
                  >
                    {initLoading ? <><span className="init-btn-spinner" /> Initing…</>
                      : initStatus === 'ok' ? <>Ready</>
                        : initStatus === 'error' ? <>Error</>
                          : <>Init</>}
                  </button>
                  <button
                    id="btn-go-home"
                    className={`init-btn${homeLoading ? ' init-btn--loading' : ''}${homeStatus === 'ok' ? ' init-btn--ok' : ''}${homeStatus === 'error' ? ' init-btn--error' : ''}`}
                    onClick={handleGoHome}
                    disabled={homeLoading}
                    title="Send robot to configured Home position (/home)"
                  >
                    {homeLoading ? <><span className="init-btn-spinner" /> Homing…</>
                      : homeStatus === 'ok' ? <>Homed</>
                        : homeStatus === 'error' ? <>Error</>
                          : <>Home</>}
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
