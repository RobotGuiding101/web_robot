import React, { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

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
  const [robotIp, setRobotIp] = useState(() => localStorage.getItem('robot_ip') || '192.168.10.110')
  const [robotDashboardPort, setRobotDashboardPort] = useState(() => localStorage.getItem('robot_dashboard_port') || '29999')
  const [robotMovePort, setRobotMovePort] = useState(() => localStorage.getItem('robot_move_port') || '30003')
  const [savedRobotIp, setSavedRobotIp] = useState(() => localStorage.getItem('robot_ip') || '192.168.10.110')
  const [robotConnected, setRobotConnected] = useState(false)
  const [robotLoading, setRobotLoading] = useState(false)

  /* Camera */
  const [camDevices, setCamDevices] = useState([])
  const [camSelected, setCamSelected] = useState('')
  const [camRunning, setCamRunning] = useState(false)
  const [camBusy, setCamBusy] = useState(false)
  const [camMsg, setCamMsg] = useState(null)

  /* Home / Init Position */
  const [homeX, setHomeX] = useState(() => localStorage.getItem('home_x') || '0.0')
  const [homeY, setHomeY] = useState(() => localStorage.getItem('home_y') || '0.0')
  const [homeZ, setHomeZ] = useState(() => localStorage.getItem('home_z') || '0.0')
  const [feedbackMsg, setFeedbackMsg] = useState(null) // { text, type: 'ok'|'error' }

  /* Save states */
  const [savedSection, setSavedSection] = useState(null)

  const showSaved = (section) => {
    setSavedSection(section)
    setTimeout(() => setSavedSection(null), 2000)
  }

  const showFeedback = (msg, type = 'ok') => {
    setFeedbackMsg({ text: msg, type })
    setTimeout(() => setFeedbackMsg(null), 3000)
  }

  useEffect(() => {
    // Check robot connection status
    apiFetch('/api/map/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.connected !== undefined) {
          setRobotConnected(data.connected)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/camera/devices')
      .then((r) => r.json())
      .then((d) => {
        setCamDevices(Array.isArray(d.devices) ? d.devices : [])
        setCamSelected(d.selected || '')
        setCamRunning(!!d.running)
      })
      .catch(() => {})
  }, [])

  /* ── Camera device scan / select ── */
  const handleScanCameras = async () => {
    setCamBusy(true)
    setCamMsg(null)
    try {
      const res = await apiFetch('/api/camera/scan', { method: 'POST' })
      const data = await res.json()
      setCamDevices(Array.isArray(data.devices) ? data.devices : [])
      setCamSelected(data.selected || '')
      setCamRunning(!!data.running)
      const n = data.devices ? data.devices.length : 0
      setCamMsg(n > 0 ? `พบ ${n} กล้อง` : 'ไม่พบกล้อง')
    } catch {
      setCamMsg('สแกนไม่สำเร็จ')
    } finally {
      setCamBusy(false)
      setTimeout(() => setCamMsg(null), 4000)
    }
  }

  const handleSelectCamera = async (serial) => {
    setCamBusy(true)
    setCamMsg(null)
    try {
      const res = await apiFetch('/api/camera/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial }),
      })
      const data = await res.json()
      setCamSelected(data.selected || serial)
      setCamRunning(!!data.running)
      setCamMsg(data.ok ? 'สลับกล้องแล้ว' : 'เปิดกล้องไม่สำเร็จ')
    } catch {
      setCamMsg('สลับกล้องไม่สำเร็จ')
    } finally {
      setCamBusy(false)
      setTimeout(() => setCamMsg(null), 4000)
    }
  }

  /* ── Robot connect test ── */
  const handleTestConnection = async () => {
    setRobotLoading(true)
    try {
      const res = await apiFetch('/api/map/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: robotIp,
          dashboard_port: parseInt(robotDashboardPort, 10) || 29999,
          move_port: parseInt(robotMovePort, 10) || 30003,
        }),
      })
      const data = await res.json()
      setRobotConnected(!!data.ok)
      if (data.ok) {
        showFeedback('Robot connected', 'ok')
      } else {
        showFeedback('Robot connection failed', 'error')
      }
    } catch {
      setRobotConnected(false)
      showFeedback('Network error', 'error')
    } finally {
      setRobotLoading(false)
    }
  }

  const handleSaveRobot = () => {
    localStorage.setItem('robot_ip', robotIp)
    localStorage.setItem('robot_dashboard_port', robotDashboardPort)
    localStorage.setItem('robot_move_port', robotMovePort)
    setSavedRobotIp(robotIp)
    window.dispatchEvent(new Event('robot_ip_changed'))
    showSaved('robot')
  }

  const handleSaveHome = () => {
    localStorage.setItem('home_x', homeX)
    localStorage.setItem('home_y', homeY)
    localStorage.setItem('home_z', homeZ)
    showSaved('home')
  }

  const handleEmergency = () => {
    apiFetch('/api/map/error', { method: 'POST' }).catch(() => {})
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
            <SettingsRow label="Ports" hint="Dashboard (29999) & Move (30003)">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#5c6f82' }}>Dashboard</span>
                <input
                  id="setting-robot-dashboard-port"
                  className="settings-input settings-input--sm"
                  type="number"
                  value={robotDashboardPort}
                  onChange={(e) => setRobotDashboardPort(e.target.value)}
                  placeholder="29999"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#5c6f82' }}>Move</span>
                <input
                  id="setting-robot-move-port"
                  className="settings-input settings-input--sm"
                  type="number"
                  value={robotMovePort}
                  onChange={(e) => setRobotMovePort(e.target.value)}
                  placeholder="30003"
                />
              </div>
            </SettingsRow>
            <SettingsRow label="Status">
              <StatusBadge connected={robotConnected} />
            </SettingsRow>
            <div className="settings-actions">
              {feedbackMsg && (
                <span className={`settings-feedback-msg${feedbackMsg.type === 'error' ? ' settings-feedback-msg--error' : ''}`}>
                  {feedbackMsg.text}
                </span>
              )}
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
            <SettingsRow label="RealSense Device" hint="เลือกกล้องที่จะใช้ (ตาม Serial Number)">
              <select
                id="setting-camera-select"
                className="settings-input"
                value={camSelected}
                onChange={(e) => handleSelectCamera(e.target.value)}
                disabled={camBusy || camDevices.length === 0}
              >
                {camDevices.length === 0 && (
                  <option value="">— ยังไม่พบกล้อง กด Scan Cameras —</option>
                )}
                {camDevices.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {(d.name || 'RealSense')} · {d.serial}{d.usb ? ` · ${d.usb}` : ''}
                  </option>
                ))}
              </select>
            </SettingsRow>
            <SettingsRow label="Status">
              <StatusBadge connected={camRunning} />
              {camMsg && <span className="settings-feedback-msg">{camMsg}</span>}
            </SettingsRow>
            <div className="settings-actions">
              <button
                id="btn-scan-cameras"
                className={`settings-btn settings-btn--secondary ${camBusy ? 'loading' : ''}`}
                onClick={handleScanCameras}
                disabled={camBusy}
              >
                {camBusy ? <><span className="settings-spinner" /> Working…</> : 'Scan Cameras'}
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