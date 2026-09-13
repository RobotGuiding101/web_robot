import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch, clearToken } from '../lib/api'
import { useNavigate, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  { img: 'assets/images/home.png' ,label: 'Dashboard', path: '/dashboard' },
  { img: 'assets/images/camera.png' ,label: 'Camera', path: '/camera' },
  { img: 'assets/images/drawing.png' ,label: 'Drawing', path: '/drawing' },
  { img: 'assets/images/3d-cube.png' ,label: 'Dobot', path: '/dobot' },
  { img: 'assets/images/settings.png' ,label: 'Settings', path: '/settings' },
]

const NavItem = ({ item, isActive, onClick }) => (
  <div
    className={`nav-item ${isActive ? 'active' : ''}`}
    onClick={() => onClick(item.path)}
    title={item.label}
    role="button"
    aria-label={item.label}
  >
    {item.img
      ? <img src={item.img} alt={item.label} className="nav-icon" />
      : item.icon
    }
  </div>
)

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
})

const LogoutIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const Sidebar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [speed, setSpeed] = useState(50)

  /* Load speed from DB on mount */
  useEffect(() => {
    apiFetch('/api/settings', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.sidebar_speed) setSpeed(Number(data.sidebar_speed))
      })
      .catch(() => {})
  }, [])

  /* Debounced save to DB */
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
            <NavItem
              key={item.path}
              item={item}
              isActive={location.pathname === item.path}
              onClick={navigate}
            />
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

      {/* ── Bottom Nav: Mobile only (shown via CSS) ── */}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            role="button"
            aria-label={item.label}
          >
            {item.img
              ? <img src={item.img} alt={item.label} className="nav-icon" />
              : item.icon
            }
            <span className="label">{item.label}</span>
          </div>
        ))}
        <div
          className="nav-item"
          onClick={handleLogout}
          role="button"
          aria-label="Logout"
        >
          <LogoutIcon size={20} />
          <span className="label">Logout</span>
        </div>
      </nav>
    </>
  )
}

export default Sidebar
