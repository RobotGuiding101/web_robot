import React from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const MENU_ITEMS = [
  { label: 'Camera\nView', path: '/camera' },
  { label: 'Drawing\nMode', path: '/drawing' },
  { label: 'Dobot\nController', path: '/dobot' },
  { label: 'System\nSettings', path: '/settings' },
]

const DashboardPage = () => {
  const navigate = useNavigate()

  const handleEmergency = () => {
    // TODO: Call POST /api/robot/emergency-stop
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Main Menu" onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="dashboard-grid">
            {MENU_ITEMS.map((item) => (
              <div
                key={item.path}
                className="card"
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
