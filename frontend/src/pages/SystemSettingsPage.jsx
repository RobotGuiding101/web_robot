import React, { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

/* ── helpers ─────────────────────────────────────────────────────────────── */
const Toggle = ({ id, checked, onChange }) => (
  <label className="settings-toggle" htmlFor={id}>
    <input id={id} type="checkbox" checked={checked} onChange={onChange} />
    <span className="settings-toggle-track"><span className="settings-toggle-thumb" /></span>
  </label>
)

const SettingsRow = ({ label, hint, children }) => (
  <div className="settings-row">
    <div className="settings-row-label">
      <span className="settings-row-name">{label}</span>
      {hint && <span className="settings-row-hint">{hint}</span>}
    </div>
    <div className="settings-row-control">{children}</div>
  </div>
)

const Section = ({ icon, title, children }) => (
  <div className="settings-section">
    <div className="settings-section-header">
      {icon && <span className="settings-section-icon">{icon}</span>}
      <span className="settings-section-title">{title}</span>
    </div>
    <div className="settings-section-body">{children}</div>
  </div>
)

const StatusBadge = ({ connected }) => (
  <span className={`settings-status-badge ${connected ? 'connected' : 'disconnected'}`}>
    <span className="settings-status-dot" />
    {connected ? 'Connected' : 'Disconnected'}
  </span>
)

/* ── API helpers ─────────────────────────────────────────────────────────── */
const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
})

/* ══════════════════════════════════════════════════════════════════════════ */
const SystemSettingsPage = () => {
  const [settings, setSettings] = useState({})
  const [robotConnected, setRobotConnected] = useState(false)
  const [robotLoading, setRobotLoading] = useState(false)
  const [savedSection, setSavedSection] = useState(null)
  const [feedbackMsg, setFeedbackMsg] = useState(null)

  const showSaved = (section) => { setSavedSection(section); setTimeout(() => setSavedSection(null), 2000) }
  const showFeedback = (msg) => { setFeedbackMsg(msg); setTimeout(() => setFeedbackMsg(null), 3000) }

  /* ── Load settings from DB ──────────────────────────────────────── */
  useEffect(() => {
    fetch('/api/settings', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setSettings(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/map/status')
      .then(r => r.json())
      .then(d => { if (d.connected !== undefined) setRobotConnected(d.connected) })
      .catch(() => {})
  }, [])

  /* ── Update a single setting locally ────────────────────────────── */
  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }))

  /* ── Save all settings to DB ────────────────────────────────────── */
  const handleSave = async (section) => {
    const entries = Object.entries(settings).map(([key, value]) => ({ key, value: String(value) }))
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ settings: entries }),
      })
      if (res.ok) showSaved(section)
      else showFeedback('Save failed')
    } catch {
      showFeedback('Network error')
    }
  }

  /* ── Robot connect test ─────────────────────────────────────────── */
  const handleTestConnection = async () => {
    setRobotLoading(true)
    try {
      const res = await fetch('/api/map/connect', { method: 'POST' })
      const data = await res.json()
      setRobotConnected(!!data.ok)
      showFeedback(data.ok ? 'Robot connected' : 'Connection failed')
    } catch {
      setRobotConnected(false)
      showFeedback('Network error')
    } finally {
      setRobotLoading(false)
    }
  }

  const handleEmergency = () => {
    fetch('/api/map/error', { method: 'POST' }).catch(() => {})
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="System Settings" ip={settings.robot_ip || ''} onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="settings-page">

            {/* ── Robot Connection ─────────────────────────────── */}
            <Section title="Robot Connection">
              <SettingsRow label="Robot IP Address" hint="Dobot CR5 Dashboard Port">
                <input
                  className="settings-input"
                  type="text"
                  value={settings.robot_ip || ''}
                  onChange={(e) => update('robot_ip', e.target.value)}
                  placeholder="192.168.10.110"
                />
              </SettingsRow>
              <SettingsRow label="Speed %" hint="Movement speed factor">
                <input
                  className="settings-input settings-input--sm"
                  type="number"
                  min="1" max="100"
                  value={settings.move_speed || '10'}
                  onChange={(e) => update('move_speed', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Status">
                <StatusBadge connected={robotConnected} />
              </SettingsRow>
              <div className="settings-actions">
                {feedbackMsg && <span className="settings-feedback-msg">{feedbackMsg}</span>}
                <button
                  className={`settings-btn settings-btn--secondary ${robotLoading ? 'loading' : ''}`}
                  onClick={handleTestConnection}
                  disabled={robotLoading}
                >
                  {robotLoading ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  className={`settings-btn settings-btn--primary ${savedSection === 'robot' ? 'saved' : ''}`}
                  onClick={() => handleSave('robot')}
                >
                  {savedSection === 'robot' ? 'Saved' : 'Save'}
                </button>
              </div>
            </Section>

            {/* ── Home Position ─────────────────────────────── */}
            <Section title="Home Position">
              <SettingsRow label="Home Pose (Base Frame)" hint="mm / deg" />
              <div className="settings-coord-grid">
                {['home_x', 'home_y', 'home_z', 'home_rx', 'home_ry', 'home_rz'].map((k) => (
                  <div className="settings-coord-field" key={k}>
                    <label className="settings-coord-label">{k.replace('home_', '').toUpperCase()}</label>
                    <input
                      className="settings-coord-input"
                      type="number" step="0.1"
                      value={settings[k] || '0.0'}
                      onChange={(e) => update(k, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <div className="settings-actions">
                <button
                  className={`settings-btn settings-btn--primary ${savedSection === 'home' ? 'saved' : ''}`}
                  onClick={() => handleSave('home')}
                >
                  {savedSection === 'home' ? 'Saved' : 'Save'}
                </button>
              </div>
            </Section>

            {/* ── Camera ────────────────────────────────────── */}
            <Section title="Camera Configuration">
              <SettingsRow label="Depth ROI" hint="Region of interest (px)">
                <input
                  className="settings-input settings-input--sm"
                  type="number" min="5" max="50"
                  value={settings.depth_roi || '15'}
                  onChange={(e) => update('depth_roi', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Min Depth (mm)">
                <input
                  className="settings-input settings-input--sm"
                  type="number" step="10"
                  value={settings.min_depth_mm || '330'}
                  onChange={(e) => update('min_depth_mm', e.target.value)}
                />
              </SettingsRow>
              <div className="settings-actions">
                <button
                  className={`settings-btn settings-btn--primary ${savedSection === 'camera' ? 'saved' : ''}`}
                  onClick={() => handleSave('camera')}
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
