import React from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const SystemSettingsPage = () => {
  const handleEmergency = () => {
    // TODO: Call POST /api/robot/emergency-stop
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="System Settings" onEmergency={handleEmergency} />
        <div className="page-content">
          {/* TODO: Add system settings forms (connection, camera config, etc.) */}

        </div>
      </div>
    </div>
  )
}

export default SystemSettingsPage
