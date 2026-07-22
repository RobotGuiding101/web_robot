import React from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const DrawingModePage = () => {
  const handleEmergency = () => {
    // TODO: Call POST /api/robot/emergency-stop
    alert('EMERGENCY STOP!')
  }

  const handleDraw = () => {
    // TODO: Trigger drawing mode on the robot arm via POST /api/robot/draw
    alert('เริ่มโหมดวาด')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Drawing Mode" onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="drawing-layout">
            {/* Camera / Canvas Area */}
            <div className="placeholder-box" style={{ flex: 1, minHeight: '260px' }}>
              {/* TODO: Camera feed or drawing canvas overlay */}
              CAMERA
            </div>

            {/* Action Button */}
            <div className="drawing-action-row">
              <button
                id="drawing-mode-btn"
                className="card drawing-btn"
                onClick={handleDraw}
              >
                เครื่องมือวาด
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DrawingModePage
