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
  const [currentStep, setCurrentStep] = useState(1)
  const [completed, setCompleted] = useState([])
  const [loading, setLoading] = useState(false)
  const [offsets, setOffsets] = useState(INITIAL_OFFSETS)
  const [logLines, setLogLines] = useState(['[INFO] Calibration tool ready.'])
  const [alignPoint, setAlignPoint] = useState(null)   // { x%, y% }
  const [calibDone, setCalibDone] = useState(false)
  const logRef = useRef(null)

  /* auto-scroll log */
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const appendLog = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setLogLines((prev) => [...prev, `[${ts}] ${msg}`])
  }, [])

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
                <StepList steps={CALIB_STEPS} current={currentStep} completed={completed} />

                <div className="calib-wizard-actions">
                  <button
                    id="btn-calib-reset"
                    className="settings-btn settings-btn--secondary"
                    onClick={handleReset}
                  >
                    ↺ Reset
                  </button>
                  <button
                    id="btn-calib-next"
                    className={`settings-btn settings-btn--primary ${loading ? 'loading' : ''} ${calibDone ? 'saved' : ''}`}
                    onClick={handleStep}
                    disabled={loading || calibDone}
                  >
                    {loading ? (
                      <><span className="settings-spinner" /> Running…</>
                    ) : calibDone ? '✓ Done' : currentStep < CALIB_STEPS.length ? `Step ${currentStep}: Confirm →` : 'Finish Calibration'}
                  </button>
                </div>
              </div>

              {/* Tool offset override */}
              <div className="calib-card">
                <div className="calib-card-header">
                  <span className="calib-card-title">Tool Offset Override</span>
                  <span className="calib-card-hint">mm / deg</span>
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
                <div className="calib-card-header">
                  <span className="calib-card-title">Camera 0 — Alignment View</span>
                  <span className="calib-card-hint">
                    {currentStep === 3 ? '👆 Click to set alignment point' : 'Live feed'}
                  </span>
                </div>
                <div
                  className={`calib-camera-box ${currentStep === 3 ? 'calib-camera-box--interactive' : ''}`}
                  onClick={currentStep === 3 ? handleCameraClick : undefined}
                >
                  {/* TODO: replace src with /api/camera/stream?id=0 */}
                  <div className="calib-camera-placeholder">

                    <span className="calib-cam-label">Camera Stream (Camera 0)</span>
                    <span className="calib-cam-sub">Connect backend to see live feed</span>
                  </div>

                  {/* Crosshair always shown */}
                  <Crosshair />

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

              {/* Log console */}
              <div className="calib-card calib-log-card">
                <div className="calib-card-header">
                  <span className="calib-card-title">Log</span>
                  <button
                    id="btn-clear-log"
                    className="calib-clear-btn"
                    onClick={() => setLogLines(['[INFO] Log cleared.'])}
                  >
                    Clear
                  </button>
                </div>
                <div className="calib-log" ref={logRef}>
                  {logLines.map((line, i) => (
                    <div key={i} className={`calib-log-line ${line.includes('[WARN]') ? 'warn' : line.includes('✓') ? 'ok' : ''}`}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CalibrationPage
