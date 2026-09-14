import React, { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const STEP_VALUES = [0.1, 1, 5, 10, 20, 50]
const CARTESIAN_AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ']
const JOINT_AXES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']
const LOG_MAX = 200
const STATUS_POLL_MS = 1000

// ── Jog Button Group ──────────────────────────────────────────────────────────
const JogGroup = ({ axes, onMove, disabled }) => (
  <div className="jog-panel">
    {axes.map((axis) => (
      <div key={axis} className="jog-row">
        <button
          id={`jog-${axis}-minus`}
          className="jog-pill jog-pill--minus"
          onClick={() => onMove(axis, '-')}
          disabled={disabled}
          title={disabled ? 'Robot not connected' : `Decrease ${axis}`}
        >
          <span className="jog-axis-badge">{axis}</span>
          <span className="jog-sign">-</span>
        </button>
        <button
          id={`jog-${axis}-plus`}
          className="jog-pill jog-pill--plus"
          onClick={() => onMove(axis, '+')}
          disabled={disabled}
          title={disabled ? 'Robot not connected' : `Increase ${axis}`}
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

    apiFetch('/api/map/robot_logs')
      .then((r) => r.json())
      .then((data) => {
        if (!dead && Array.isArray(data.entries)) {
          setLines(data.entries.map(e => ({ t: e.t || '', msg: e.msg || e })))
        }
      })
      .catch(() => { })

    const pollInterval = setInterval(() => {
      if (dead || pausedRef.current) return
      apiFetch('/api/map/robot_logs')
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

  const [connected, setConnected] = useState(false)
  const [jogError, setJogError] = useState(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [getCoordinatesEnabled, setGetCoordinatesEnabled] = useState(true)
  const getCoordinatesRef = useRef(true)
  getCoordinatesRef.current = getCoordinatesEnabled
  const [toolIndex, setToolIndex] = useState(0)
  const [userIndex, setUserIndex] = useState(0)
  const [frameMsg, setFrameMsg] = useState(null)

  // ── Stable cache-buster ──
  const viewerKey = useRef(Date.now())
  const viewerBoxRef = useRef(null)
  const [isViewerFullscreen, setIsViewerFullscreen] = useState(false)
  const jogGuardRef = useRef(0)
  const frameDirtyRef = useRef(false)

  // ── Target pose from 3D Gizmo drag ──
  const [targetPose, setTargetPose] = useState(null) // { x, y, z, rx, ry, rz, joints }
  const [ghostPose, setGhostPose] = useState(null)   // { x, y, z, rx, ry, rz, joints }
  const [ghostList, setGhostList] = useState([])     // array of all ghost waypoints
  const [latestGhost, setLatestGhost] = useState(null)
  const [moveMode, setMoveMode] = useState('movj')    // 'movj' | 'movl' | 'joint'
  const [moveToLoading, setMoveToLoading] = useState(false)
  const [moveToStatus, setMoveToStatus] = useState(null) // 'ok' | 'error' | null
  const [moveToError, setMoveToError] = useState(null)

  // ── Auto-connect + init robot on mount ─────────────────────────────────
  useEffect(() => {
    const autoInit = async () => {
      try {
        await apiFetch('/api/map/connect', { method: 'POST' })
        await apiFetch('/api/map/camstart', { method: 'POST' })
        await apiFetch('/api/map/init', { method: 'POST' })
      } catch { /* ignore */ }
    }
    autoInit()
  }, [])

  // ── Load speed from DB settings ───────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('access_token') || ''
    apiFetch('/api/settings', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.sidebar_speed) setSpeed(Number(data.sidebar_speed))
      })
      .catch(() => {})
  }, [])

  // ── Poll real robot status from /api/map/status ──────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/status')
      if (!res.ok) return
      const data = await res.json()

      setConnected(!!data.connected)

      if (!frameDirtyRef.current) {
        if (data.tool_index !== undefined && data.tool_index !== null) setToolIndex(data.tool_index)
        if (data.user_index !== undefined && data.user_index !== null) setUserIndex(data.user_index)
      }

      if (!getCoordinatesRef.current) return

      const guarded = Date.now() < jogGuardRef.current

      if (!guarded && Array.isArray(data.pose) && data.pose.length === 6) {
        setPos({
          X: +data.pose[0].toFixed(2),
          Y: +data.pose[1].toFixed(2),
          Z: +data.pose[2].toFixed(2),
          RX: +data.pose[3].toFixed(2),
          RY: +data.pose[4].toFixed(2),
          RZ: +data.pose[5].toFixed(2),
        })
      }

      if (!guarded && Array.isArray(data.angles) && data.angles.length === 6) {
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
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, STATUS_POLL_MS)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // ── Sync real robot joints → 3D model iframe ─────────────────────────────
  useEffect(() => {
    if (!viewerReady || !getCoordinatesEnabled) return
    const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
    if (!iframe || !iframe.contentWindow) return
    const jArr = [joints.J1, joints.J2, joints.J3, joints.J4, joints.J5, joints.J6]
    iframe.contentWindow.postMessage({ type: 'setJoints', joints: jArr }, '*')
  }, [joints, viewerReady, getCoordinatesEnabled])

  // ── Receive 3D viewer TCP / Joint updates + Gizmo drag events ─
  useEffect(() => {
    const handleMessage = (e) => {
      if (!e.data) return

      // Gizmo drag started — auto-pause real robot sync
      if (e.data.type === 'gizmoDragStart') {
        setGetCoordinatesEnabled(false)
        return
      }

      // Gizmo drag released — capture the final IK-solved target pose
      if (e.data.type === 'targetPoseUpdate') {
        if (typeof e.data.x === 'number') {
          setTargetPose({
            x: +Number(e.data.x).toFixed(1),
            y: +Number(e.data.y).toFixed(1),
            z: +Number(e.data.z).toFixed(1),
            rx: +Number(e.data.rx || 0).toFixed(1),
            ry: +Number(e.data.ry || 0).toFixed(1),
            rz: +Number(e.data.rz || 0).toFixed(1),
            joints: Array.isArray(e.data.joints) ? e.data.joints : null,
          })
        }
        return
      }

      // Multiple ghosts updated
      if (e.data.type === 'ghostListUpdate') {
        const list = Array.isArray(e.data.ghosts) ? e.data.ghosts : []
        setGhostList(list)
        setLatestGhost(e.data.latest || null)
        if (e.data.latest && e.data.latest.pose) {
          setGhostPose({
            ...e.data.latest.pose,
            joints: e.data.latest.joints,
          })
        } else {
          setGhostPose(null)
        }
        return
      }

      // Single ghost fallback
      if (e.data.type === 'ghostPoseUpdate') {
        if (typeof e.data.x === 'number') {
          setGhostPose({
            x: +Number(e.data.x).toFixed(1),
            y: +Number(e.data.y).toFixed(1),
            z: +Number(e.data.z).toFixed(1),
            rx: +Number(e.data.rx || 0).toFixed(1),
            ry: +Number(e.data.ry || 0).toFixed(1),
            rz: +Number(e.data.rz || 0).toFixed(1),
            joints: Array.isArray(e.data.joints) ? e.data.joints : null,
          })
        }
        return
      }

      // Ghost cleared
      if (e.data.type === 'ghostCleared') {
        setGhostList([])
        setLatestGhost(null)
        setGhostPose(null)
        return
      }

      // Legacy tcpUpdate — only update UI coords when auto-sync is off
      if (e.data.type === 'tcpUpdate') {
        if (!getCoordinatesRef.current) {
          if (typeof e.data.x === 'number') {
            setPos({
              X: +Number(e.data.x).toFixed(2),
              Y: +Number(e.data.y).toFixed(2),
              Z: +Number(e.data.z).toFixed(2),
              RX: +Number(e.data.rx || 0).toFixed(2),
              RY: +Number(e.data.ry || 0).toFixed(2),
              RZ: +Number(e.data.rz || 0).toFixed(2),
            })
          }
          if (Array.isArray(e.data.joints) && e.data.joints.length === 6) {
            setJoints({
              J1: +Number(e.data.joints[0]).toFixed(2),
              J2: +Number(e.data.joints[1]).toFixed(2),
              J3: +Number(e.data.joints[2]).toFixed(2),
              J4: +Number(e.data.joints[3]).toFixed(2),
              J5: +Number(e.data.joints[4]).toFixed(2),
              J6: +Number(e.data.joints[5]).toFixed(2),
            })
          }
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // ── Global shortcut keys (R = Snap Ghost, C = Clear Ghosts) ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'r' || e.key === 'R') {
        const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'snapGhost' }, '*')
        }
      } else if (e.key === 'c' || e.key === 'C') {
        const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'clearAllGhosts' }, '*')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleGetCoordinates = () => {
    setGetCoordinatesEnabled((prev) => {
      const next = !prev
      if (next) {
        setTimeout(fetchStatus, 50)
      }
      return next
    })
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleEmergency = () => {
    apiFetch('/api/map/error', { method: 'POST' }).catch(() => { })
    alert('EMERGENCY STOP!')
  }

  const handleApplyFrame = async () => {
    try {
      const res = await apiFetch('/api/map/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_index: Number(toolIndex),
          user_index: Number(userIndex),
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok !== false) {
        setFrameMsg({ kind: 'ok', text: `Tool ${data.tool_index} / User ${data.user_index}` })
        frameDirtyRef.current = false
      } else {
        setFrameMsg({ kind: 'error', text: (data && data.error) || 'Failed' })
      }
    } catch {
      setFrameMsg({ kind: 'error', text: 'Failed' })
    }
    setTimeout(() => setFrameMsg(null), 3000)
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
      const res = await apiFetch('/api/map/error', { method: 'POST' })
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
      await apiFetch('/api/map/connect', { method: 'POST' })
      const res = await apiFetch('/api/map/init', { method: 'POST' })
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
      const res = await apiFetch('/api/map/home', { method: 'POST' })
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

  // ── Move to Gizmo target pose ──────────────────────────────────────────────
  const handleMoveTo = useCallback(async () => {
    if (!targetPose || !connected) return
    setMoveToLoading(true)
    setMoveToStatus(null)
    setMoveToError(null)
    try {
      const body = {
        mode: moveMode,
        speed: Math.max(1, Math.min(100, speed || 20)),
      }
      if (moveMode === 'joint' && targetPose.joints) {
        body.joints = targetPose.joints
      } else {
        body.x  = targetPose.x;  body.y  = targetPose.y;  body.z  = targetPose.z
        body.rx = targetPose.rx; body.ry = targetPose.ry; body.rz = targetPose.rz
      }
      const res = await apiFetch('/api/map/move_to', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        setMoveToStatus('ok')
        setLastMoved('Move to Target')
        // Resume auto-sync after brief delay so position readout updates
        setTimeout(() => { setGetCoordinatesEnabled(true); setTimeout(fetchStatus, 800) }, 800)
      } else {
        setMoveToStatus('error')
        setMoveToError(data.error || 'Move failed')
      }
    } catch (err) {
      setMoveToStatus('error')
      setMoveToError(String(err))
    } finally {
      setMoveToLoading(false)
      setTimeout(() => setMoveToStatus(null), 3000)
    }
  }, [targetPose, connected, moveMode, speed, fetchStatus])

  const handleMove = async (axis, direction) => {
    if (!connected) return
    const delta = direction === '+' ? stepValue : -stepValue
    setLastMoved(`${axis}${direction}`)
    setJogError(null)
    jogGuardRef.current = Date.now() + 700

    const isJoint = axis.startsWith('J')
    const url = isJoint ? '/api/map/jog_joint' : '/api/map/jog'
    const body = isJoint
      ? { joint: parseInt(axis.replace('J', '')), amount: delta, speed }
      : { axis: axis.toLowerCase(), amount: delta, speed }

    if (isJoint) {
      setJoints((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    } else {
      setPos((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    }

    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || (data && data.ok === false)) {
        setJogError((data && data.error) || 'Jog rejected')
        setTimeout(() => setJogError(null), 3000)
      }
    } catch {
      setJogError('Jog request failed')
      setTimeout(() => setJogError(null), 3000)
    }
    setTimeout(fetchStatus, 800)
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
                  onLoad={() => setViewerReady(true)}
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
                  {jogError && (
                    <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{jogError}</span>
                  )}
                  {lastMoved && (
                    <span className="ctrl-last-action">Last: <strong>{lastMoved}</strong></span>
                  )}
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      background: connected ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: connected ? '#4ade80' : '#ef4444',
                      border: `1px solid ${connected ? 'rgba(74, 222, 128, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                    }}
                  >
                    {connected ? 'Connected' : 'Disconnected'}
                  </span>
                  <button
                    id="btn-toggle-get-coords"
                    className={`init-btn ${getCoordinatesEnabled ? 'init-btn--toggle-active' : 'init-btn--toggle-paused'}`}
                    onClick={toggleGetCoordinates}
                    title={
                      getCoordinatesEnabled
                        ? 'Auto Get Robot Coordinates is ON. Click to pause/cancel so you can freely move the 3D robot arm.'
                        : 'Auto Get Robot Coordinates is OFF (Paused). 3D robot arm can be moved freely. Click to resume syncing.'
                    }
                  >
                    {getCoordinatesEnabled ? 'Get Pos: ON' : 'Get Pos: OFF'}
                  </button>
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

              {/* ── Frame (Tool / User) ── */}
              <div className="step-row">
                <div className="step-row-label-wrap">
                  <span className="step-row-label">Frame</span>
                  <span className="step-row-sub">Tool / User</span>
                </div>
                <div className="frame-wrap">
                  <label className="frame-field">
                    <span>Tool</span>
                    <input
                      type="number"
                      min="0"
                      max="19"
                      value={toolIndex}
                      onChange={(e) => { frameDirtyRef.current = true; setToolIndex(e.target.value) }}
                      disabled={!connected}
                    />
                  </label>
                  <label className="frame-field">
                    <span>User</span>
                    <input
                      type="number"
                      min="0"
                      max="9"
                      value={userIndex}
                      onChange={(e) => { frameDirtyRef.current = true; setUserIndex(e.target.value) }}
                      disabled={!connected}
                    />
                  </label>
                  <button className="frame-apply" onClick={handleApplyFrame} disabled={!connected}>
                    Apply
                  </button>
                  {frameMsg && (
                    <span className={`frame-msg frame-msg--${frameMsg.kind}`}>{frameMsg.text}</span>
                  )}
                </div>
              </div>

              {/* ── Jog Panels ── */}
                <div className="jog-dual">
                <div className="jog-box">
                  <div className="jog-box-header"><span className="jog-box-title">Cartesian</span></div>
                  <JogGroup axes={CARTESIAN_AXES} onMove={handleMove} disabled={!connected} />
                </div>
                <div className="jog-box">
                  <div className="jog-box-header"><span className="jog-box-title">Joint</span></div>
                  <JogGroup axes={JOINT_AXES} onMove={handleMove} disabled={!connected} />
                </div>
              </div>

            {/* ── Target Pose & Move Card ── */}
              <div className="target-pose-card">
                {/* ── Ghost Pose Multi-Round Bar ── */}
                <div className="ghost-pose-banner">
                  <div className="ghost-pose-info">
                    <span className="ghost-badge">เงาสีเทา</span>
                    {ghostList.length > 0 ? (
                      <span className="ghost-coords">
                        บันทึก <strong>{ghostList.length}</strong> จุด (ล่าสุด: X:{latestGhost?.pose?.x} Y:{latestGhost?.pose?.y} Z:{latestGhost?.pose?.z})
                      </span>
                    ) : (
                      <span className="ghost-empty-tip">
                        กด <strong>Snap เงา (R)</strong> เพื่อบันทึกเงาใน 3D (ทำได้หลายจุด)
                      </span>
                    )}
                  </div>
                  <div className="ghost-actions">
                    <button
                      type="button"
                      className="ghost-action-btn ghost-action-btn--snap"
                      title="กด Snap เพื่อบันทึกเงาสีเทา ณ ตำแหน่งนี้ (กดได้หลายรอบตามต้องการ)"
                      onClick={() => {
                        const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
                        if (iframe && iframe.contentWindow) {
                          iframe.contentWindow.postMessage({ type: 'snapGhost' }, '*')
                        }
                      }}
                    >
                      Snap เงา (R)
                    </button>
                    {ghostList.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="ghost-action-btn ghost-action-btn--restore"
                          title="ดึงเป้าหมายกลับมาที่ตำแหน่งเงาล่าสุด"
                          onClick={() => {
                            const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
                            if (iframe && iframe.contentWindow) {
                              iframe.contentWindow.postMessage({ type: 'restoreGhost' }, '*')
                            }
                            if (latestGhost && latestGhost.pose) {
                              setTargetPose({
                                ...latestGhost.pose,
                                joints: latestGhost.joints,
                              })
                            }
                          }}
                        >
                          ↺ ดึงท่าล่าสุด
                        </button>
                        <button
                          type="button"
                          className="ghost-action-btn ghost-action-btn--clear"
                          title="ลบเงาทั้งหมดออกจาก 3D"
                          onClick={() => {
                            const iframe = document.querySelector('iframe[title="Robot Arm 3D Viewer"]')
                            if (iframe && iframe.contentWindow) {
                              iframe.contentWindow.postMessage({ type: 'clearAllGhosts' }, '*')
                            }
                          }}
                        >
                          ✕ ลบเงา ({ghostList.length})
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="target-pose-header">
                  <span className="target-pose-title">เป้าหมายจากการลาก</span>
                  {targetPose
                    ? <span className="target-pose-ready">✓ พร้อมสั่ง</span>
                    : <span className="target-pose-empty">ลาก Gizmo ใน 3D เพื่อตั้งเป้าหมาย</span>
                  }
                </div>

                {targetPose && (
                  <div className="target-pose-coords">
                    <div className="tp-col">
                      <div className="tp-label">X</div><div className="tp-val">{targetPose.x}</div>
                      <div className="tp-diff">{(targetPose.x - pos.X).toFixed(1)}</div>
                    </div>
                    <div className="tp-col">
                      <div className="tp-label">Y</div><div className="tp-val">{targetPose.y}</div>
                      <div className="tp-diff">{(targetPose.y - pos.Y).toFixed(1)}</div>
                    </div>
                    <div className="tp-col">
                      <div className="tp-label">Z</div><div className="tp-val">{targetPose.z}</div>
                      <div className="tp-diff">{(targetPose.z - pos.Z).toFixed(1)}</div>
                    </div>
                    <div className="tp-col">
                      <div className="tp-label">Rx</div><div className="tp-val">{targetPose.rx}</div>
                      <div className="tp-diff">{(targetPose.rx - pos.RX).toFixed(1)}</div>
                    </div>
                    <div className="tp-col">
                      <div className="tp-label">Ry</div><div className="tp-val">{targetPose.ry}</div>
                      <div className="tp-diff">{(targetPose.ry - pos.RY).toFixed(1)}</div>
                    </div>
                    <div className="tp-col">
                      <div className="tp-label">Rz</div><div className="tp-val">{targetPose.rz}</div>
                      <div className="tp-diff">{(targetPose.rz - pos.RZ).toFixed(1)}</div>
                    </div>
                  </div>
                )}

                <div className="target-pose-actions">
                  <div className="move-mode-pills">
                    {[['movj', 'MovJ'], ['movl', 'MovL'], ['joint', 'Joint']].map(([val, label]) => (
                      <button
                        key={val}
                        className={`move-mode-pill ${moveMode === val ? 'active' : ''}`}
                        onClick={() => setMoveMode(val)}
                        title={val === 'movj' ? 'Joint interpolation (safer, recommended)' : val === 'movl' ? 'Linear Cartesian move' : 'Direct joint angles'}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="target-pose-btns">
                    <button
                      id="btn-move-to-target"
                      className={`move-to-btn${
                        moveToLoading ? ' move-to-btn--loading'
                        : moveToStatus === 'ok' ? ' move-to-btn--ok'
                        : moveToStatus === 'error' ? ' move-to-btn--error' : ''
                      }`}
                      onClick={handleMoveTo}
                      disabled={!targetPose || !connected || moveToLoading}
                      title={!connected ? 'Robot not connected' : !targetPose ? 'Drag Gizmo in 3D viewer first' : 'Send robot to target position'}
                    >
                      {moveToLoading ? <><span className="init-btn-spinner" /> Executing…</>
                        : moveToStatus === 'ok' ? <>✓ Sent!</>
                        : moveToStatus === 'error' ? <>✕ Error</>
                        : <>▶ Move Robot to Target</>}
                    </button>

                    <button
                      id="btn-reset-target"
                      className="reset-target-btn"
                      onClick={() => { setTargetPose(null); setGetCoordinatesEnabled(true); setTimeout(fetchStatus, 50) }}
                      title="Clear target pose and resume auto position sync"
                    >
                      ↺ Reset
                    </button>
                  </div>

                  {moveToError && (
                    <div className="move-to-error">{moveToError}</div>
                  )}
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
