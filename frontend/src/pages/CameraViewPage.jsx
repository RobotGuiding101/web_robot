import React from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const CameraViewPage = () => {
  const handleEmergency = () => {
    // TODO: Call POST /api/robot/emergency-stop
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Camera View" onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="camera-layout">
            {/* Main Camera Feed */}
            <div className="placeholder-box" style={{ position: 'relative', minHeight: '260px' }}>
              {/* TODO: Render live camera stream via MJPEG → <img src="/api/camera/stream" /> */}
              <span>CAMERA</span>
              <button
                style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', minWidth: '44px', minHeight: '44px' }}
                title="Fullscreen"
              >
                ⛶
              </button>
            </div>

            {/* Right Panel */}
            <div className="camera-right-panel">
              <div className="placeholder-box" style={{ flex: 1, minHeight: '120px' }}>
                {/* TODO: Second camera feed */}
                CAMERA
              </div>
              <div className="card" style={{ flex: 1, minHeight: '120px' }}>
                Menu<br />Calibration
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CameraViewPage
