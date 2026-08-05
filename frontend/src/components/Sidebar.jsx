import React, { useState } from 'react'
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

const Sidebar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [speed, setSpeed] = useState(50)

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
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span>SPEED</span>
        </div>
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
      </nav>
    </>
  )
}

export default Sidebar
