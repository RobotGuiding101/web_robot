import React, { useState, useEffect, useRef } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const CameraViewPage = () => {
  const [status, setStatus] = useState({ connected: false, camera_running: false })
  const [snapshot, setSnapshot] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const streamRef = useRef(null)

  // Poll robot/camera status
  useEffect(() => {
    let dead = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/map/status')
        if (!res.ok || dead) return
        const data = await res.json()
        if (!dead) setStatus(data)
      } catch { /* ignore */ }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => { dead = true; clearInterval(interval) }
  }, [])

  const handleEmergency = () => {
    fetch('/api/map/error', { method: 'POST' }).catch(() => { })
    alert('EMERGENCY STOP!')
  }

  const handleSnapshot = async () => {
    try {
      const res = await fetch('/api/camera/snapshot')
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setSnapshot(url)
        // Auto-clear after 5 seconds
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
    } catch { /* ignore */ }
  }

  const handleStartCamera = async () => {
    try {
      await fetch('/api/map/connect', { method: 'POST' })
      await fetch('/api/map/camstart', { method: 'POST' })
    } catch { /* ignore */ }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Camera View" onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="camera-layout">
            {/* Main Camera Feed */}
            <div
              className="placeholder-box"
              style={{
                position: 'relative',
                minHeight: '300px',
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: '12px',
              }}
            >
              {status.camera_running ? (
                <img
                  ref={streamRef}
                  src="/api/map/video_feed"
                  alt="Camera Stream"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: '#888' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📷</div>
                  <div style={{ fontSize: '14px', marginBottom: '16px' }}>
                    {status.connected ? 'Camera not started' : 'Robot not connected'}
                  </div>
                  <button
                    onClick={handleStartCamera}
                    style={{
                      background: '#1a8fe3',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 24px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                  >
                    Start Camera
                  </button>
                </div>
              )}

              {/* Status indicator */}
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(0,0,0,0.6)',
                  borderRadius: '20px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  color: '#fff',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: status.camera_running ? '#4ade80' : '#ef4444',
                  }}
                />
                {status.camera_running ? 'LIVE' : 'OFFLINE'}
              </div>

              {/* Buttons */}
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <button
                  onClick={handleSnapshot}
                  disabled={!status.camera_running}
                  style={{
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    cursor: status.camera_running ? 'pointer' : 'not-allowed',
                    fontSize: '13px',
                    opacity: status.camera_running ? 1 : 0.5,
                  }}
                  title="Take Snapshot"
                >
                  📸 Snapshot
                </button>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  style={{
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                  title="Fullscreen"
                >
                  ⛶
                </button>
              </div>
            </div>

            {/* Right Panel */}
            <div className="camera-right-panel">
              {/* Snapshot preview */}
              <div
                className="card"
                style={{
                  flex: 1,
                  minHeight: '120px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '12px',
                }}
              >
                {snapshot ? (
                  <img
                    src={snapshot}
                    alt="Snapshot"
                    style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '8px' }}
                  />
                ) : (
                  <span style={{ color: '#888', fontSize: '13px' }}>No snapshot yet</span>
                )}
              </div>

              {/* Camera Info */}
              <div
                className="card"
                style={{
                  flex: 1,
                  minHeight: '120px',
                  borderRadius: '12px',
                  padding: '16px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>
                  Camera Status
                </div>
                <div style={{ fontSize: '12px', color: '#aaa', lineHeight: '2' }}>
                  <div>Connected: <strong style={{ color: status.connected ? '#4ade80' : '#ef4444' }}>{status.connected ? 'Yes' : 'No'}</strong></div>
                  <div>Camera: <strong style={{ color: status.camera_running ? '#4ade80' : '#ef4444' }}>{status.camera_running ? 'Running' : 'Stopped'}</strong></div>
                  <div>Robot Mode: <strong style={{ color: '#60a5fa' }}>{status.robot_mode_label || '?'}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CameraViewPage
