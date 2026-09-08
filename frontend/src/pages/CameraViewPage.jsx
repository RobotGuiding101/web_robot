import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const CameraViewPage = () => {
  const [status, setStatus] = useState({ connected: false, camera_running: false })
  const [cameraMode, setCameraMode] = useState('rgb')
  const [modeLoading, setModeLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const streamRef = useRef(null)
  const cameraBoxRef = useRef(null)

  // Poll robot/camera status
  useEffect(() => {
    let dead = false
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/map/status')
        if (!res.ok || dead) return
        const data = await res.json()
        if (!dead) {
          setStatus(data)
          if (data.camera_mode) {
            setCameraMode(data.camera_mode)
          }
        }
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

  const handleModeChange = async (newMode) => {
    if (cameraMode === newMode || modeLoading) return
    setModeLoading(true)
    try {
      const res = await fetch('/api/camera/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCameraMode(data.mode)
        }
      }
    } catch { /* ignore */ }
    finally {
      setModeLoading(false)
    }
  }

  const handleStartCamera = async () => {
    try {
      await fetch('/api/map/connect', { method: 'POST' })
      await fetch('/api/map/camstart', { method: 'POST' })
    } catch { /* ignore */ }
  }

  // Track native fullscreen changes (e.g. user presses Escape)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const handleFullscreen = useCallback(async () => {
    const el = cameraBoxRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen() } catch { /* ignore */ }
    } else {
      try { await document.exitFullscreen() } catch { /* ignore */ }
    }
  }, [])

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Camera View" onEmergency={handleEmergency} />
        <div className="page-content">
          <div className="camera-layout">
            {/* Main Camera Feed */}
            <div
              ref={cameraBoxRef}
              className="placeholder-box"
              style={{
                position: 'relative',
                minHeight: '300px',
                background: '#090d14',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              }}
            >
              {status.camera_running ? (
                <img
                  ref={streamRef}
                  src="/api/map/video_feed"
                  alt="RealSense D455 Camera Stream"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: '#888' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}></div>
                  <div style={{ fontSize: '13px', marginBottom: '20px', color: '#777' }}>
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
                      boxShadow: '0 4px 12px rgba(26, 143, 227, 0.35)',
                    }}
                  >
                    Start Camera
                  </button>
                </div>
              )}

              {/* Status indicator & Active Mode Tag (Top-Left) */}
              <div
                style={{
                  position: 'absolute',
                  top: '14px',
                  left: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: '20px',
                    padding: '5px 14px',
                    fontSize: '12px',
                    color: '#fff',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: status.camera_running ? '#4ade80' : '#ef4444',
                      boxShadow: status.camera_running ? '0 0 8px #4ade80' : 'none',
                    }}
                  />
                  {status.camera_running ? 'LIVE' : 'OFFLINE'}
                </div>

                {status.camera_running && (
                  <div
                    style={{
                      background:
                        cameraMode === 'rgb'
                          ? 'rgba(37, 99, 235, 0.8)'
                          : cameraMode === 'depth'
                          ? 'rgba(220, 38, 38, 0.8)'
                          : 'rgba(75, 85, 99, 0.8)',
                      borderRadius: '20px',
                      padding: '5px 12px',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#fff',
                      backdropFilter: 'blur(8px)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.6px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                    }}
                  >
                    {cameraMode}
                  </div>
                )}
              </div>

              {/* Controls inside camera (Top-Right) */}
              <div
                style={{
                  position: 'absolute',
                  top: '14px',
                  right: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  zIndex: 10,
                }}
              >
                {/* Segmented Mode Switcher inside camera */}
                <div
                  style={{
                    display: 'flex',
                    background: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: '10px',
                    padding: '3px',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <button
                    onClick={() => handleModeChange('rgb')}
                    disabled={!status.camera_running || modeLoading}
                    style={{
                      background: cameraMode === 'rgb' ? '#2563eb' : 'transparent',
                      color: cameraMode === 'rgb' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'rgb' ? '700' : '500',
                      cursor: status.camera_running ? 'pointer' : 'not-allowed',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to RGB Color"
                  >
                    RGB
                  </button>
                  <button
                    onClick={() => handleModeChange('gray')}
                    disabled={!status.camera_running || modeLoading}
                    style={{
                      background: cameraMode === 'gray' ? '#4b5563' : 'transparent',
                      color: cameraMode === 'gray' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'gray' ? '700' : '500',
                      cursor: status.camera_running ? 'pointer' : 'not-allowed',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to Grayscale"
                  >
                    Gray
                  </button>
                  <button
                    onClick={() => handleModeChange('depth')}
                    disabled={!status.camera_running || modeLoading}
                    style={{
                      background: cameraMode === 'depth' ? '#dc2626' : 'transparent',
                      color: cameraMode === 'depth' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'depth' ? '700' : '500',
                      cursor: status.camera_running ? 'pointer' : 'not-allowed',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to Depth Heatmap"
                  >
                    Depth
                  </button>
                </div>

                {/* Fullscreen Button */}
                <button
                  onClick={handleFullscreen}
                  style={{
                    background: 'rgba(0, 0, 0, 0.7)',
                    color: '#fff',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.18s ease',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  }}
                  title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  ⛶
                </button>
              </div>
            </div>

            {/* Right Panel */}
            <div className="camera-right-panel">
              {/* ช่องขวาบน (ว่างไว้) */}
              <div
                className="card"
                style={{
                  flex: 1,
                  minHeight: '120px',
                  borderRadius: '12px',
                }}
              />

              {/* ช่องขวาล่าง (Camera Status) */}
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
                  <div>Mode: <strong style={{ color: cameraMode === 'rgb' ? '#60a5fa' : cameraMode === 'depth' ? '#f87171' : '#9ca3af' }}>{cameraMode.toUpperCase()}</strong></div>
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
