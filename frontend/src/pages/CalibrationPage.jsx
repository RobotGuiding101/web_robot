import React, { useState, useRef, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

/* ════════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════════ */
const CALIB_STEPS = [
  {
    id: 1,
    title: 'Move to Home Position',
    desc: 'Command the robot to move to its mechanical home position. Ensure workspace is clear.',
    icon: '🏠',
  },
  {
    id: 2,
    title: 'Set Reference Point',
    desc: 'Manually jog the arm to the calibration reference origin and confirm the position.',
    icon: '📍',
  },
  {
    id: 3,
    title: 'Camera Alignment',
    desc: 'Align camera crosshairs with the calibration target on the work surface.',
    icon: '🎯',
  },
  {
    id: 4,
    title: 'Verify & Save',
    desc: 'System validates the calibration data and saves offsets to the controller.',
    icon: '✅',
  },
]

const INITIAL_OFFSETS = { x: 0.0, y: 0.0, z: 0.0, rx: 0.0, ry: 0.0, rz: 0.0 }

/* ── Crosshair Overlay (camera alignment) ──────── */
const Crosshair = ({ onClick }) => (
  <div className="calib-crosshair-wrap" onClick={onClick} title="Click to set alignment point">
    <div className="calib-ch-h" />
    <div className="calib-ch-v" />
    <div className="calib-ch-dot" />
  </div>
)

/* ── Step indicator ───────────────────────────── */
const StepList = ({ steps, current, completed }) => (
  <div className="calib-steps">
    {steps.map((s) => {
      const done = completed.includes(s.id)
      const active = current === s.id
      return (
        <div
          key={s.id}
          className={`calib-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}
        >
          <div className="calib-step-num">
            {done ? '✓' : s.id}
          </div>
          <div className="calib-step-info">
            <span className="calib-step-title">{s.title}</span>
            {active && <span className="calib-step-desc">{s.desc}</span>}
          </div>
          <span className="calib-step-icon">{s.icon}</span>
        </div>
      )
    })}
  </div>
)

/* ════════════════════════════════════════════════
   CalibrationPage
   ════════════════════════════════════════════════ */
const CalibrationPage = () => {
  const [status, setStatus]             = useState({ connected: false, camera_running: false })
  const [cameraMode, setCameraMode]     = useState('rgb')
  const [modeLoading, setModeLoading]   = useState(false)
  const [activeTab, setActiveTab]       = useState('status') // 'status' | 'log'
  const [currentStep, setCurrentStep]   = useState(1)
  const [completed, setCompleted]       = useState([])
  const [loading, setLoading]           = useState(false)
  const [offsets, setOffsets]           = useState(INITIAL_OFFSETS)
  const [logLines, setLogLines]         = useState(['[INFO] Calibration tool ready.'])
  const [alignPoint, setAlignPoint]     = useState(null)   // { x%, y% }
  const [calibDone, setCalibDone]       = useState(false)
  const logRef   = useRef(null)
  const logSince = useRef(0)   // ring-buffer cursor for /api/map/logs

  // Poll robot/camera status
  useEffect(() => {
    let dead = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/map/status')
        if (!res.ok || dead) return
        const data = await res.json()
        if (!dead) {
          setStatus(data)
          if (data.camera_mode) {
            setCameraMode(data.camera_mode)
          }
        }
      } catch { /* ignore */ }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => { dead = true; clearInterval(interval) }
  }, [])

  // Poll server log ring-buffer (same source as Camera View page)
  useEffect(() => {
    let dead = false
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/map/logs?since=${logSince.current}`)
        if (!res.ok || dead) return
        const data = await res.json()
        if (!dead && data.entries && data.entries.length > 0) {
          logSince.current = data.latest
          setLogLines((prev) => [
            ...prev,
            ...data.entries.map((e) => `[SERVER] ${e}`),
          ])
        }
      } catch { /* ignore */ }
    }
    fetchLogs()
    const interval = setInterval(fetchLogs, 1500)
    return () => { dead = true; clearInterval(interval) }
  }, [])

  /* auto-scroll log */
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const appendLog = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setLogLines((prev) => [...prev, `[${ts}] ${msg}`])
  }, [])

  const handleStartCamera = async () => {
    try {
      appendLog('Starting camera...')
      await fetch('/api/map/connect', { method: 'POST' })
      const res = await fetch('/api/map/camstart', { method: 'POST' })
      if (res.ok) {
        appendLog('Camera started ✓')
      }
    } catch {
      appendLog('[WARN] Failed to start camera')
    }
  }

  const handleModeChange = async (newMode) => {
    if (cameraMode === newMode || modeLoading) return
    setModeLoading(true)
    try {
      const res = await fetch('/api/camera/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCameraMode(data.mode)
          appendLog(`Switched camera mode to ${data.mode.toUpperCase()}`)
        }
      }
    } catch { /* ignore */ }
    finally {
      setModeLoading(false)
    }
  }

  /* ── Step actions ─────────────────────────── */
  const handleStep = async () => {
    setLoading(true)
    const step = currentStep

    if (step === 1) {
      appendLog('Sending HOME command to robot…')
      await new Promise((r) => setTimeout(r, 1500))  // TODO: POST /api/robot/home
      appendLog('Robot reached home position ✓')
    } else if (step === 2) {
      appendLog('Recording current TCP pose as reference origin…')
      await new Promise((r) => setTimeout(r, 1000))  // TODO: GET /api/robot/status → save pose
      appendLog('Reference point saved ✓')
    } else if (step === 3) {
      if (!alignPoint) {
        appendLog('[WARN] Click on the camera feed to set alignment point first.')
        setLoading(false)
        return
      }
      appendLog(`Camera alignment point set at (${alignPoint.x.toFixed(1)}%, ${alignPoint.y.toFixed(1)}%) ✓`)
      await new Promise((r) => setTimeout(r, 800))
    } else if (step === 4) {
      appendLog('Validating calibration data…')
      await new Promise((r) => setTimeout(r, 1800))  // TODO: POST /api/calibration/save
      appendLog('Calibration saved to controller ✓')
      appendLog('─────────────────────────────')
      appendLog('Calibration complete! System ready.')
      setCalibDone(true)
    }

    setCompleted((prev) => [...prev, step])
    if (step < CALIB_STEPS.length) setCurrentStep(step + 1)
    setLoading(false)
  }

  const handleReset = () => {
    setCurrentStep(1)
    setCompleted([])
    setOffsets(INITIAL_OFFSETS)
    setAlignPoint(null)
    setCalibDone(false)
    logSince.current = 0
    setLogLines(['[INFO] Calibration reset.'])
  }

  const handleOffsetChange = (key, val) => {
    setOffsets((prev) => ({ ...prev, [key]: parseFloat(val) || 0 }))
  }

  const handleCameraClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setAlignPoint({ x, y })
    appendLog(`Alignment point selected at (${x.toFixed(1)}%, ${y.toFixed(1)}%)`)
  }

  const handleEmergency = () => alert('EMERGENCY STOP!')

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Calibration" onEmergency={handleEmergency} />
        <div className="page-content calib-page">

          <div className="calib-layout">

            {/* ── Left column ──────────────────────────── */}
            <div className="calib-left">

              {/* Step list */}
              <div className="calib-card">
                <div className="calib-card-header">
                  <span className="calib-card-title">Calibration Wizard</span>
                  {calibDone && (
                    <span className="calib-done-badge">✓ Complete</span>
                  )}
                </div>
                <div className="calib-card-body">
                  <StepList
                    steps={CALIB_STEPS}
                    current={currentStep}
                    completed={completed}
                  />
                  <div className="calib-actions">
                    <button
                      id="btn-calib-step"
                      className="settings-btn settings-btn--primary"
                      disabled={loading || calibDone}
                      onClick={handleStep}
                    >
                      {loading ? (
                        <span className="calib-spinner" />
                      ) : calibDone ? (
                        'Calibration Done'
                      ) : (
                        `Step ${currentStep}: ${CALIB_STEPS[currentStep - 1]?.title ?? 'Execute'}`
                      )}
                    </button>
                    <button
                      id="btn-calib-reset"
                      className="settings-btn settings-btn--secondary"
                      onClick={handleReset}
                      disabled={loading}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>

              {/* Tool Offset Calibration */}
              <div className="calib-card">
                <div className="calib-card-header">
                  <span className="calib-card-title">Tool Offsets (TCP)</span>
                  <span className="calib-card-hint">Values in mm / deg</span>
                </div>
                <div className="calib-offset-grid">
                  {Object.entries(offsets).map(([k, v]) => (
                    <div key={k} className="calib-offset-item">
                      <label className="calib-offset-label" htmlFor={`offset-${k}`}>{k.toUpperCase()}</label>
                      <input
                        id={`offset-${k}`}
                        className="calib-offset-input"
                        type="number"
                        step="0.01"
                        value={v}
                        onChange={(e) => handleOffsetChange(k, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <button
                  id="btn-apply-offset"
                  className="settings-btn settings-btn--primary"
                  style={{ marginTop: 12 }}
                  onClick={() => appendLog(`Tool offsets applied: ${JSON.stringify(offsets)}`)}
                >
                  Apply Offsets
                </button>
              </div>

            </div>

            {/* ── Right column ─────────────────────────── */}
            <div className="calib-right">

              {/* Camera feed + crosshair */}
              <div className="calib-card calib-camera-card">
                <div className="calib-card-header" style={{ background: '#0f1923', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="calib-card-title" style={{ color: '#e2e8f0' }}>Camera Alignment View</span>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: status.camera_running ? '#4ade80' : '#ef4444',
                        boxShadow: status.camera_running ? '0 0 8px #4ade80' : 'none',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: status.camera_running ? '#4ade80' : '#ef4444', fontWeight: '700' }}>
                      {status.camera_running ? 'LIVE' : 'OFFLINE'}
                    </span>
                  </div>

                  {/* Mode switcher pills */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div
                      style={{
                        display: 'flex',
                        background: 'rgba(0,0,0,0.5)',
                        borderRadius: '8px',
                        padding: '3px',
                        border: '1px solid rgba(255,255,255,0.12)',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      {['rgb', 'gray', 'depth'].map((m) => (
                        <button
                          key={m}
                          onClick={() => handleModeChange(m)}
                          disabled={!status.camera_running || modeLoading}
                          style={{
                            background: cameraMode === m ? (m === 'rgb' ? '#2563eb' : m === 'depth' ? '#dc2626' : '#4b5563') : 'transparent',
                            color: cameraMode === m ? '#fff' : '#94a3b8',
                            border: 'none',
                            borderRadius: '5px',
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: cameraMode === m ? '700' : '500',
                            cursor: status.camera_running ? 'pointer' : 'not-allowed',
                            textTransform: 'uppercase',
                            transition: 'all 0.15s ease',
                            letterSpacing: '0.4px',
                          }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      {currentStep === 3 ? '👆 Click point' : ''}
                    </span>
                  </div>
                </div>

                <div
                  className={`calib-camera-box ${currentStep === 3 ? 'calib-camera-box--interactive' : ''}`}
                  onClick={currentStep === 3 ? handleCameraClick : undefined}
                >
                  {status.camera_running ? (
                    <img
                      src="/api/map/video_feed"
                      alt="Camera Stream"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : (
                    <div className="calib-camera-placeholder" style={{ pointerEvents: 'auto' }}>
                      <span className="calib-cam-sub">
                        {status.connected ? 'Camera not started' : 'Robot not connected'}
                      </span>
                      <button
                        onClick={handleStartCamera}
                        style={{
                          background: '#1a8fe3',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '6px 16px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '600',
                          marginTop: '6px',
                        }}
                      >
                        Start Camera
                      </button>
                    </div>
                  )}

                  {/* User-selected alignment point */}
                  {alignPoint && (
                    <div
                      className="calib-align-marker"
                      style={{ left: `${alignPoint.x}%`, top: `${alignPoint.y}%` }}
                      title={`Alignment: (${alignPoint.x.toFixed(1)}%, ${alignPoint.y.toFixed(1)}%)`}
                    />
                  )}
                </div>
              </div>

              {/* Camera Status & Log console */}
              <div className="calib-card calib-log-card">
                <div className="calib-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setActiveTab('status')}
                      style={{
                        background: activeTab === 'status' ? '#ffffff' : 'transparent',
                        border: activeTab === 'status' ? '1.5px solid #cdd6e3' : '1.5px solid transparent',
                        borderRadius: '6px',
                        padding: '4px 12px',
                        fontWeight: activeTab === 'status' ? '700' : '500',
                        color: activeTab === 'status' ? '#1a2f45' : '#64748b',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Camera Status
                    </button>
                    <button
                      onClick={() => setActiveTab('log')}
                      style={{
                        background: activeTab === 'log' ? '#ffffff' : 'transparent',
                        border: activeTab === 'log' ? '1.5px solid #cdd6e3' : '1.5px solid transparent',
                        borderRadius: '6px',
                        padding: '4px 12px',
                        fontWeight: activeTab === 'log' ? '700' : '500',
                        color: activeTab === 'log' ? '#1a2f45' : '#64748b',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Log ({logLines.length})
                    </button>
                  </div>
                  {activeTab === 'log' && (
                    <button
                      id="btn-clear-log"
                      className="calib-clear-btn"
                      onClick={() => setLogLines(['[INFO] Log cleared.'])}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {activeTab === 'status' ? (
                  <div style={{ padding: '14px 16px', fontSize: '13px', color: '#64748b', lineHeight: '2.1' }}>
                    <div>Connected: <strong style={{ color: status.connected ? '#16a34a' : '#ef4444' }}>{status.connected ? 'Yes' : 'No'}</strong></div>
                    <div>Camera: <strong style={{ color: status.camera_running ? '#16a34a' : '#ef4444' }}>{status.camera_running ? 'Running' : 'Stopped'}</strong></div>
                    <div>Mode: <strong style={{ color: cameraMode === 'rgb' ? '#2563eb' : cameraMode === 'depth' ? '#dc2626' : '#64748b' }}>{cameraMode.toUpperCase()}</strong></div>
                    <div>Robot Mode: <strong style={{ color: '#2563eb' }}>{status.robot_mode_label || '?'}</strong></div>
                  </div>
                ) : (
                  <div className="calib-log" ref={logRef}>
                    {logLines.map((line, i) => (
                      <div
                        key={i}
                        className={`calib-log-line ${
                          line.includes('[WARN]') ? 'warn' :
                          line.includes('✓') ? 'ok' :
                          line.includes('[SERVER]') ? 'server' : ''
                        }`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CalibrationPage
