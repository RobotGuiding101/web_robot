import React from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

/* ── SVG Icons ─────────────────────────────────────────────────────────── */
const IconRobot = ({ size = 36, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

const IconController = ({ size = 36, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L8 7H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5l-4-5z" />
    <line x1="8" y1="12" x2="8" y2="12" strokeWidth="3" />
    <line x1="8" y1="15" x2="8" y2="15" strokeWidth="3" />
    <line x1="6.5" y1="13.5" x2="9.5" y2="13.5" strokeWidth="1.8" />
    <circle cx="16" cy="12" r="1" fill={color} />
    <circle cx="16" cy="15" r="1" fill={color} />
  </svg>
)

const IconCamera = ({ size = 36, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
    <circle cx="8.5" cy="12" r="3" />
  </svg>
)

const IconPen = ({ size = 36, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    <path d="M15 5l3 3" />
  </svg>
)

const IconSettings = ({ size = 36, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const IconArrow = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

const MENU_ITEMS = [
  {
    label: 'Dobot Controller',
    desc: 'Jog, IK control & 3D live viewer',
    Icon: IconController,
    path: '/dobot',
    accent: '#4a72a0',
    accentBg: 'linear-gradient(135deg, #edf1f7 0%, #e2e9f2 100%)',
    tag: 'Control',
  },
  {
    label: 'Camera View',
    desc: 'Live feeds from onboard cameras',
    Icon: IconCamera,
    path: '/camera',
    accent: '#4a72a0',
    accentBg: 'linear-gradient(135deg, #edf1f7 0%, #e2e9f2 100%)',
    tag: 'Vision',
  },
  {
    label: 'Drawing Mode',
    desc: 'Path planning & auto-draw routines',
    Icon: IconPen,
    path: '/drawing',
    accent: '#4a72a0',
    accentBg: 'linear-gradient(135deg, #edf1f7 0%, #e2e9f2 100%)',
    tag: 'Auto',
  },
  {
    label: 'System Settings',
    desc: 'IP, ports, cameras & security',
    Icon: IconSettings,
    path: '/settings',
    accent: '#4a72a0',
    accentBg: 'linear-gradient(135deg, #edf1f7 0%, #e2e9f2 100%)',
    tag: 'Config',
  },
]

const DashboardPage = () => {
  const navigate = useNavigate()

  const handleEmergency = () => {
    fetch('/api/robot/emergency-stop', { method: 'POST' }).catch(() => { })
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Main Menu" onEmergency={handleEmergency} />
        <div className="page-content dashboard-page">

          {/* ── Hero Header ── */}
          <div className="dashboard-hero">
            <div className="dashboard-hero-icon">
              <IconRobot size={48} color="#1a8fe3" />
            </div>
            <div className="dashboard-hero-text">
              <h1 className="dashboard-hero-title">Robot Arm Control System</h1>
              <p className="dashboard-hero-sub">Dobot CR5 · Select a module to get started</p>
            </div>
          </div>

          {/* ── Menu Grid ── */}
          <div className="dashboard-grid-new">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.path}
                className="dash-card"
                style={{ '--accent': item.accent, '--accent-bg': item.accentBg }}
                onClick={() => navigate(item.path)}
              >
                <div className="dash-card-top">
                  <span className="dash-card-icon">
                    <item.Icon size={36} color={item.accent} />
                  </span>
                  <span className="dash-card-tag">
                    {item.tag}
                  </span>
                </div>
                <div className="dash-card-body">
                  <span className="dash-card-label">{item.label}</span>
                  <span className="dash-card-desc">{item.desc}</span>
                </div>
                <span className="dash-card-arrow">
                  <IconArrow size={18} color={item.accent} />
                </span>
              </button>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}

export default DashboardPage
