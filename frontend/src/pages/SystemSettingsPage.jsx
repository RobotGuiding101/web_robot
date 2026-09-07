import React, { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

/* ── helper: toggle-switch ─────────────────────── */
const Toggle = ({ id, checked, onChange }) => (
  <label className="settings-toggle" htmlFor={id}>
    <input id={id} type="checkbox" checked={checked} onChange={onChange} />
    <span className="settings-toggle-track">
      <span className="settings-toggle-thumb" />
    </span>
  </label>
)

/* ── helper: settings row ──────────────────────── */
const SettingsRow = ({ label, hint, children }) => (
  <div className="settings-row">
    <div className="settings-row-label">
      <span className="settings-row-name">{label}</span>
      {hint && <span className="settings-row-hint">{hint}</span>}
    </div>
    <div className="settings-row-control">{children}</div>
  </div>
)

/* ── helper: section card ──────────────────────── */
const Section = ({ icon, title, children }) => (
  <div className="settings-section">
    <div className="settings-section-header">
      {icon && <span className="settings-section-icon">{icon}</span>}
      <span className="settings-section-title">{title}</span>
    </div>
    <div className="settings-section-body">{children}</div>
  </div>
)

/* ── StatusBadge ──────────────────────────────── */
const StatusBadge = ({ connected }) => (
  <span className={`settings-status-badge ${connected ? 'connected' : 'disconnected'}`}>
    <span className="settings-status-dot" />
    {connected ? 'Connected' : 'Disconnected'}
  </span>
)

/* ════════════════════════════════════════════════
   SystemSettingsPage
   ════════════════════════════════════════════════ */
const SystemSettingsPage = () => {
  /* Robot connection */
  const [robotIp, setRobotIp] = useState('192.168.10.110')
  const [robotPort, setRobotPort] = useState('29999')
  const [robotConnected, setRobotConnected] = useState(false)
  const [robotLoading, setRobotLoading] = useState(false)

  /* Camera */
  const [cam0Index, setCam0Index] = useState('0')
  const [cam1Index, setCam1Index] = useState('1')
  const [cam0Enabled, setCam0Enabled] = useState(true)
  const [cam1Enabled, setCam1Enabled] = useState(true)
  const [camResolution, setCamResolution] = useState('640x480')
  const [camFps, setCamFps] = useState('30')

  /* Home / Init Position */
  const [homeX, setHomeX] = useState(() => localStorage.getItem('home_x') || '0.0')
  const [homeY, setHomeY] = useState(() => localStorage.getItem('home_y') || '0.0')
  const [homeZ, setHomeZ] = useState(() => localStorage.getItem('home_z') || '0.0')
  const [homeRx, setHomeRx] = useState(() => localStorage.getItem('home_rx') || '0.0')
  const [homeRy, setHomeRy] = useState(() => localStorage.getItem('home_ry') || '0.0')
  const [homeRz, setHomeRz] = useState(() => localStorage.getItem('home_rz') || '0.0')
  const [feedbackMsg, setFeedbackMsg] = useState(null)

  /* Save states */
  const [savedSection, setSavedSection] = useState(null)

  const showSaved = (section) => {
    setSavedSection(section)
    setTimeout(() => setSavedSection(null), 2000)
  }

  const showFeedback = (msg) => {
    setFeedbackMsg(msg)
    setTimeout(() => setFeedbackMsg(null), 3000)
  }

  useEffect(() => {
    // Check robot connection status
    fetch('/api/map/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.connected !== undefined) {
          setRobotConnected(data.connected)
        }
      })
      .catch(() => {})
  }, [])

  /* ── Robot connect test ── */
  const handleTestConnection = async () => {
    setRobotLoading(true)
    try {
      const res = await fetch('/api/map/connect', { method: 'POST' })
      const data = await res.json()
      setRobotConnected(!!data.ok)
      if (data.ok) {
        showFeedback('Robot connected')
      } else {
        showFeedback('Robot connection failed')
      }
    } catch {
      setRobotConnected(false)
      showFeedback('Network error')
    } finally {
      setRobotLoading(false)
    }
  }

  const handleSaveRobot = () => {
    showSaved('robot')
  }

  const handleSaveCamera = () => {
    showSaved('camera')
  }

  /* ── Home Handlers (local save only) ── */
  const handleSaveHome = () => {
    localStorage.setItem('home_x', homeX)
    localStorage.setItem('home_y', homeY)
    localStorage.setItem('home_z', homeZ)
    localStorage.setItem('home_rx', homeRx)
    localStorage.setItem('home_ry', homeRy)
    localStorage.setItem('home_rz', homeRz)
    showSaved('home')
  }

  const handleEmergency = () => {
    fetch('/api/map/error', { method: 'POST' }).catch(() => {})
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="System Settings" onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="settings-page">

            {/* ── Robot Connection ─────────────────────────────── */}
            <Section title="Robot Connection">
            <SettingsRow label="Robot IP Address" hint="Dobot CR5 Dashboard Port">
              <input
                id="setting-robot-ip"
                className="settings-input"
                type="text"
                value={robotIp}
                onChange={(e) => setRobotIp(e.target.value)}
                placeholder="192.168.10.110"
              />
            </SettingsRow>
            <SettingsRow label="Port" hint="Default: 29999">
              <input
                id="setting-robot-port"
                className="settings-input settings-input--sm"
                type="number"
                value={robotPort}
                onChange={(e) => setRobotPort(e.target.value)}
                placeholder="29999"
              />
            </SettingsRow>
            <SettingsRow label="Status">
              <StatusBadge connected={robotConnected} />
            </SettingsRow>
            <div className="settings-actions">
              {feedbackMsg && <span className="settings-feedback-msg">{feedbackMsg}</span>}
              <button
                id="btn-test-connection"
                className={`settings-btn settings-btn--secondary ${robotLoading ? 'loading' : ''}`}
                onClick={handleTestConnection}
                disabled={robotLoading}
              >
                {robotLoading ? (
                  <><span className="settings-spinner" /> Testing…</>
                ) : 'Test Connection'}
              </button>
              <button
                id="btn-save-robot"
                className={`settings-btn settings-btn--primary ${savedSection === 'robot' ? 'saved' : ''}`}
                onClick={handleSaveRobot}
              >
                {savedSection === 'robot' ? 'Saved' : 'Save'}
              </button>
            </div>
          </Section>

          {/* ── Home Position Configuration ────────── */}
          <Section title="Home Position Configuration">
            <SettingsRow
              label="Home Pose (Base Frame)"
              hint="Coordinates for robot home position (mm / deg)"
            />

            <div className="settings-coord-grid">
              <div className="settings-coord-field">
                <label className="settings-coord-label" htmlFor="home-x">X</label>
                <input
                  id="home-x"
                  className="settings-coord-input"
                  type="number"
                  step="0.1"
                  value={homeX}
                  onChange={(e) => setHomeX(e.target.value)}
                  placeholder="0.0"
                />
              </div>
              <div className="settings-coord-field">
                <label className="settings-coord-label" htmlFor="home-y">Y</label>
                <input
                  id="home-y"
                  className="settings-coord-input"
                  type="number"
                  step="0.1"
                  value={homeY}
                  onChange={(e) => setHomeY(e.target.value)}
                  placeholder="0.0"
                />
              </div>
              <div className="settings-coord-field">
                <label className="settings-coord-label" htmlFor="home-z">Z</label>
                <input
                  id="home-z"
                  className="settings-coord-input"
                  type="number"
                  step="0.1"
                  value={homeZ}
                  onChange={(e) => setHomeZ(e.target.value)}
                  placeholder="0.0"
                />
              </div>
              <div className="settings-coord-field">
                <label className="settings-coord-label" htmlFor="home-rx">Rx</label>
                <input
                  id="home-rx"
                  className="settings-coord-input"
                  type="number"
                  step="0.1"
                  value={homeRx}
                  onChange={(e) => setHomeRx(e.target.value)}
                  placeholder="0.0"
                />
              </div>
              <div className="settings-coord-field">
                <label className="settings-coord-label" htmlFor="home-ry">Ry</label>
                <input
                  id="home-ry"
                  className="settings-coord-input"
                  type="number"
                  step="0.1"
                  value={homeRy}
                  onChange={(e) => setHomeRy(e.target.value)}
                  placeholder="0.0"
                />
              </div>
              <div className="settings-coord-field">
                <label className="settings-coord-label" htmlFor="home-rz">Rz</label>
                <input
                  id="home-rz"
                  className="settings-coord-input"
                  type="number"
                  step="0.1"
                  value={homeRz}
                  onChange={(e) => setHomeRz(e.target.value)}
                  placeholder="0.0"
                />
              </div>
            </div>

            <div className="settings-actions">
              <button
                id="btn-save-home"
                className={`settings-btn settings-btn--primary ${savedSection === 'home' ? 'saved' : ''}`}
                onClick={handleSaveHome}
              >
                {savedSection === 'home' ? 'Saved' : 'Save'}
              </button>
            </div>
          </Section>

          {/* ── Camera Configuration ─────────────────────────── */}
          <Section title="Camera Configuration">
            <SettingsRow label="Camera 0 (Main)" hint="USB /dev/video index">
              <Toggle id="toggle-cam0" checked={cam0Enabled} onChange={(e) => setCam0Enabled(e.target.checked)} />
              <input
                id="setting-cam0-index"
                className="settings-input settings-input--sm"
                type="number"
                value={cam0Index}
                onChange={(e) => setCam0Index(e.target.value)}
                disabled={!cam0Enabled}
              />
            </SettingsRow>
            <SettingsRow label="Camera 1 (Secondary)" hint="USB /dev/video index">
              <Toggle id="toggle-cam1" checked={cam1Enabled} onChange={(e) => setCam1Enabled(e.target.checked)} />
              <input
                id="setting-cam1-index"
                className="settings-input settings-input--sm"
                type="number"
                value={cam1Index}
                onChange={(e) => setCam1Index(e.target.value)}
                disabled={!cam1Enabled}
              />
            </SettingsRow>
            <SettingsRow label="Resolution">
              <select
                id="setting-cam-resolution"
                className="settings-select"
                value={camResolution}
                onChange={(e) => setCamResolution(e.target.value)}
              >
                <option value="320x240">320 × 240</option>
                <option value="640x480">640 × 480</option>
                <option value="1280x720">1280 × 720 (HD)</option>
                <option value="1920x1080">1920 × 1080 (FHD)</option>
              </select>
            </SettingsRow>
            <SettingsRow label="Frame Rate" hint="fps">
              <select
                id="setting-cam-fps"
                className="settings-select"
                value={camFps}
                onChange={(e) => setCamFps(e.target.value)}
              >
                <option value="10">10 fps</option>
                <option value="15">15 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </SettingsRow>
            <div className="settings-actions">
              <button
                id="btn-save-camera"
                className={`settings-btn settings-btn--primary ${savedSection === 'camera' ? 'saved' : ''}`}
                onClick={handleSaveCamera}
              >
                {savedSection === 'camera' ? 'Saved' : 'Save'}
              </button>
            </div>
          </Section>

          </div>
        </div>
      </div>
    </div>
  )
}

export default SystemSettingsPage
