import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch, clearToken } from '../lib/api'
import { useNavigate, useLocation } from 'react-router-dom'

/* ── SVG Icons (same as DashboardPage) ───────────────────────────────────── */
const IconHome = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const IconCamera = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
    <circle cx="8.5" cy="12" r="3" />
  </svg>
)

const IconPen = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    <path d="M15 5l3 3" />
  </svg>
)

const IconController = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L8 7H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5l-4-5z" />
    <line x1="8" y1="12" x2="8" y2="12" strokeWidth="3" />
    <line x1="8" y1="15" x2="8" y2="15" strokeWidth="3" />
    <line x1="6.5" y1="13.5" x2="9.5" y2="13.5" strokeWidth="1.8" />
    <circle cx="16" cy="12" r="1" fill="currentColor" />
    <circle cx="16" cy="15" r="1" fill="currentColor" />
  </svg>
)

const IconSettings = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const IconRobotArm = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <rect x="9" y="7" width="6" height="4" rx="1" />
    <line x1="12" y1="7" x2="12" y2="4" />
    <circle cx="12" cy="3" r="1" />
    <line x1="7" y1="16" x2="7" y2="16" strokeWidth="3" />
    <line x1="12" y1="16" x2="12" y2="16" strokeWidth="3" />
    <line x1="17" y1="16" x2="17" y2="16" strokeWidth="3" />
    <line x1="3" y1="15" x2="1" y2="15" />
    <line x1="21" y1="15" x2="23" y2="15" />
  </svg>
)

const LogoutIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const IconLog = ({ size = 30, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="10" y1="9" x2="16" y2="9" />
  </svg>
)

/* ── Nav items with SVG icons ────────────────────────────────────────────── */
const NAV_ITEMS = [
  { Icon: IconHome,       label: 'Dashboard', path: '/dashboard' },
  { Icon: IconCamera,     label: 'Camera',    path: '/camera' },
  { Icon: IconPen,        label: 'Drawing',   path: '/drawing' },
  { Icon: IconController, label: 'Dobot',     path: '/dobot' },
  { Icon: IconLog,        label: 'Logs',      path: '/logs' },
  { Icon: IconSettings,   label: 'Settings',  path: '/settings' },
]

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
})

const Sidebar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [speed, setSpeed] = useState(50)

  useEffect(() => {
    apiFetch('/api/settings', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.sidebar_speed) setSpeed(Number(data.sidebar_speed))
      })
      .catch(() => {})
  }, [])

  const saveSpeed = useCallback((val) => {
    apiFetch('/api/settings', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ settings: [{ key: 'sidebar_speed', value: String(val) }] }),
    }).catch(() => {})
  }, [])

  const handleSpeedChange = (e) => {
    const val = Number(e.target.value)
    setSpeed(val)
    saveSpeed(val)
  }

  const handleLogout = useCallback(() => {
    clearToken()
    localStorage.removeItem('username')
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <>
      {/* ── Sidebar: Tablet / Desktop ── */}
      <div className="sidebar">
        <div className="logo" title="Robot Arm System">
          <img src="assets/images/robot-arm.png" alt="Robot Arm System" className="nav-icon" />
        </div>

        <div className="nav-items">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              title={item.label}
              role="button"
              aria-label={item.label}
            >
              <item.Icon size={28} />
            </div>
          ))}
        </div>

        <div className="speed-control">
          <span>{speed}%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={speed}
            onChange={handleSpeedChange}
          />
          <span>SPEED</span>
        </div>

        <button className="logout-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
          <LogoutIcon size={18} />
          <span>LOGOUT</span>
        </button>
      </div>

      {/* ── Bottom Nav: Mobile only ── */}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            role="button"
            aria-label={item.label}
          >
            <item.Icon size={20} />
            <span className="label">{item.label}</span>
          </div>
        ))}
        <div className="nav-item" onClick={handleLogout} role="button" aria-label="Logout">
          <LogoutIcon size={20} />
          <span className="label">Logout</span>
        </div>
      </nav>
    </>
  )
}

export default Sidebar