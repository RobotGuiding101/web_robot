import React, { useState } from 'react'
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
      <span className="settings-section-icon">{icon}</span>
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
  const [robotIp, setRobotIp] = useState('192.168.1.6')
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

  /* Security */
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  /* Network / CORS */
  const [allowedOrigins, setAllowedOrigins] = useState('http://localhost:5173')
  const [autoReconnect, setAutoReconnect] = useState(true)

  /* Save states */
  const [savedSection, setSavedSection] = useState(null)

  const showSaved = (section) => {
    setSavedSection(section)
    setTimeout(() => setSavedSection(null), 2000)
  }

  /* ── Robot connect test ── */
  const handleTestConnection = async () => {
    setRobotLoading(true)
    try {
      // TODO: replace with real fetch
      await new Promise((r) => setTimeout(r, 1200))
      setRobotConnected(true)
    } catch {
      setRobotConnected(false)
    } finally {
      setRobotLoading(false)
    }
  }

  const handleSaveRobot = () => {
    // TODO: PATCH /api/settings/robot  { ip: robotIp, port: robotPort }
    showSaved('robot')
  }

  const handleSaveCamera = () => {
    // TODO: PATCH /api/settings/camera
    showSaved('camera')
  }

  const handleSavePassword = () => {
    if (!newPw || newPw !== confirmPw) {
      alert('Password mismatch or empty')
      return
    }
    // TODO: POST /api/auth/change-password
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    showSaved('security')
  }

  const handleSaveNetwork = () => {
    // TODO: PATCH /api/settings/network
    showSaved('network')
  }

  const handleEmergency = () => alert('EMERGENCY STOP!')

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="System Settings" onEmergency={handleEmergency} />
        <div className="page-content settings-page">

          {/* ── Robot Connection ─────────────────────────────── */}
          <Section icon="🤖" title="Robot Connection">
            <SettingsRow label="Robot IP Address" hint="Dobot CR5 Dashboard Port">
              <input
                id="setting-robot-ip"
                className="settings-input"
                type="text"
                value={robotIp}
                onChange={(e) => setRobotIp(e.target.value)}
                placeholder="192.168.1.6"
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
              <button
                id="btn-test-connection"
                className={`settings-btn settings-btn--secondary ${robotLoading ? 'loading' : ''}`}
                onClick={handleTestConnection}
                disabled={robotLoading}
              >
                {robotLoading ? (
                  <><span className="settings-spinner" /> Testing…</>
                ) : '🔌 Test Connection'}
              </button>
              <button
                id="btn-save-robot"
                className={`settings-btn settings-btn--primary ${savedSection === 'robot' ? 'saved' : ''}`}
                onClick={handleSaveRobot}
              >
                {savedSection === 'robot' ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </Section>

          {/* ── Camera Configuration ─────────────────────────── */}
          <Section icon="📷" title="Camera Configuration">
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
                {savedSection === 'camera' ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </Section>

          {/* ── Security ─────────────────────────────────────── */}
          <Section icon="🔐" title="Security">
            <SettingsRow label="Current Password">
              <input
                id="setting-current-pw"
                className="settings-input"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="••••••••"
              />
            </SettingsRow>
            <SettingsRow label="New Password">
              <input
                id="setting-new-pw"
                className="settings-input"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="••••••••"
              />
            </SettingsRow>
            <SettingsRow label="Confirm Password">
              <input
                id="setting-confirm-pw"
                className="settings-input"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="••••••••"
              />
            </SettingsRow>
            <div className="settings-actions">
              <button
                id="btn-save-password"
                className={`settings-btn settings-btn--primary ${savedSection === 'security' ? 'saved' : ''}`}
                onClick={handleSavePassword}
              >
                {savedSection === 'security' ? '✓ Saved' : 'Change Password'}
              </button>
            </div>
          </Section>

          {/* ── Network ──────────────────────────────────────── */}
          <Section icon="🌐" title="Network">
            <SettingsRow label="Allowed Origins (CORS)" hint="Comma-separated URLs">
              <input
                id="setting-allowed-origins"
                className="settings-input settings-input--wide"
                type="text"
                value={allowedOrigins}
                onChange={(e) => setAllowedOrigins(e.target.value)}
                placeholder="http://localhost:5173,http://192.168.1.x"
              />
            </SettingsRow>
            <SettingsRow label="Auto Reconnect" hint="Reconnect robot on disconnect">
              <Toggle
                id="toggle-auto-reconnect"
                checked={autoReconnect}
                onChange={(e) => setAutoReconnect(e.target.checked)}
              />
            </SettingsRow>
            <div className="settings-actions">
              <button
                id="btn-save-network"
                className={`settings-btn settings-btn--primary ${savedSection === 'network' ? 'saved' : ''}`}
                onClick={handleSaveNetwork}
              >
                {savedSection === 'network' ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}

export default SystemSettingsPage
