import React, { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import CameraStream, { setStreamMode } from '../components/CameraStream'

const CameraViewPage = () => {
  const [status, setStatus] = useState({ connected: false, camera_running: false })
  const [cameraMode, setCameraMode] = useState('rgb')
  const [modeLoading, setModeLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [camDevices, setCamDevices] = useState([])
  const [primarySerial, setPrimarySerial] = useState('')
  const [secondaryDevice, setSecondaryDevice] = useState(null)
  const [stream2Key, setStream2Key] = useState(Date.now())
  const [stream2Error, setStream2Error] = useState(false)
  const [viewSwapped, setViewSwapped] = useState(false)
  const cameraBoxRef = useRef(null)

  // Poll robot/camera status
  useEffect(() => {
    let dead = false
    const fetchStatus = async () => {
      try {
        const res = await apiFetch('/api/map/status')
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

  // Poll camera devices to detect second camera
  const fetchDevices = useCallback(async () => {
    try {
      const res = await apiFetch('/api/camera/devices')
      if (!res.ok) return
      const data = await res.json()
      const devs = Array.isArray(data.devices) ? data.devices : []
      setCamDevices(devs)
      const curPrimary = data.selected || ''
      setPrimarySerial(curPrimary)
      const sec = data.secondary_device || devs.find((d) => d.serial && d.serial !== curPrimary) || null
      setSecondaryDevice(sec)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchDevices()
    const interval = setInterval(fetchDevices, 3000)
    return () => clearInterval(interval)
  }, [fetchDevices])


  const handleSwapView = () => {
    if (!secondaryDevice) return
    setViewSwapped((v) => !v)
  }

  const handleEmergency = () => {
    apiFetch('/api/map/emergency', { method: 'POST' }).catch(() => { })
  }

  const handleModeChange = async (newMode) => {
    if (cameraMode === newMode || modeLoading) return
    setModeLoading(true)
    try {
      const res = await apiFetch('/api/camera/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCameraMode(data.mode)
          setStreamMode(data.mode)
        }
      }
    } catch { /* ignore */ }
    finally {
      setModeLoading(false)
    }
  }

  useEffect(() => {
    const dock = document.getElementById('camera-stream-dock')
    const el = document.getElementById('global-camera-stream')
    const box = cameraBoxRef.current
    if (el && box) box.appendChild(el)
    return () => {
      if (el && dock) dock.appendChild(el)
    }
  }, [])

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
                      background: status.camera_running ? '#4ade80' : '#22c55e',
                      boxShadow: '0 0 8px #4ade80',
                    }}
                  />
                  LIVE
                </div>

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
              </div>

              {/* Stream2 overlay — shown when view is swapped so cam2 fills main area */}
              {viewSwapped && secondaryDevice && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 5,
                    background: '#05070a',
                  }}
                >
                  <CameraStream
                    key={stream2Key}
                    src="/api/camera/stream2"
                    withMode={false}
                    onError={() => setStream2Error(true)}
                    onFrame={() => setStream2Error(false)}
                  />
                </div>
              )}

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
                    disabled={modeLoading}
                    style={{
                      background: cameraMode === 'rgb' ? '#2563eb' : 'transparent',
                      color: cameraMode === 'rgb' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'rgb' ? '700' : '500',
                      cursor: modeLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to RGB Color"
                  >
                    RGB
                  </button>
                  <button
                    onClick={() => handleModeChange('gray')}
                    disabled={modeLoading}
                    style={{
                      background: cameraMode === 'gray' ? '#4b5563' : 'transparent',
                      color: cameraMode === 'gray' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'gray' ? '700' : '500',
                      cursor: modeLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to Grayscale"
                  >
                    Gray
                  </button>
                  <button
                    onClick={() => handleModeChange('depth')}
                    disabled={modeLoading}
                    style={{
                      background: cameraMode === 'depth' ? '#dc2626' : 'transparent',
                      color: cameraMode === 'depth' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'depth' ? '700' : '500',
                      cursor: modeLoading ? 'not-allowed' : 'pointer',
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
              {/* ช่องขวาบน — กล้องตัวที่ 2 */}
              <div
                className="placeholder-box"
                style={{
                  flex: 1,
                  minHeight: '230px',
                  borderRadius: '12px',
                  background: '#090d14',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'default',
                }}
              >
                {/* Header bar */}
                <div
                  style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    right: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    zIndex: 10,
                    pointerEvents: 'auto',
                  }}
                >
                  {/* Status & Name badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'rgba(0, 0, 0, 0.75)',
                        borderRadius: '20px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        color: '#fff',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        fontWeight: 600,
                      }}
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: secondaryDevice && !stream2Error ? '#4ade80' : '#64748b',
                          boxShadow: secondaryDevice && !stream2Error ? '0 0 6px #4ade80' : 'none',
                        }}
                      />
                      CAM 2
                    </div>

                    {secondaryDevice && (
                      <div
                        style={{
                          background: 'rgba(30, 41, 59, 0.8)',
                          borderRadius: '20px',
                          padding: '4px 10px',
                          fontSize: '10px',
                          color: '#94a3b8',
                          backdropFilter: 'blur(8px)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          fontWeight: 600,
                          maxWidth: '120px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`${secondaryDevice.name || 'RealSense'} (${secondaryDevice.serial})`}
                      >
                        {secondaryDevice.serial}
                      </div>
                    )}
                  </div>

                  {/* Actions (Swap View / Refresh) */}
                  {secondaryDevice && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={handleSwapView}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: viewSwapped ? 'rgba(124, 58, 237, 0.85)' : 'rgba(37, 99, 235, 0.85)',
                          color: '#fff',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: '16px',
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          backdropFilter: 'blur(8px)',
                          transition: 'all 0.18s ease',
                        }}
                        title={viewSwapped ? 'คืนตำแหน่งกล้อง (Unswap view)' : 'สลับมุมมองกล้อง (Swap view only)'}
                      >
                        ⇄ {viewSwapped ? 'Restore' : 'Swap'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStream2Key(Date.now())
                          setStream2Error(false)
                        }}
                        style={{
                          background: 'rgba(0, 0, 0, 0.65)',
                          color: '#94a3b8',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          borderRadius: '50%',
                          width: '26px',
                          height: '26px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: '12px',
                          padding: 0,
                        }}
                        title="รีเฟรชสตรีมกล้อง (Refresh stream)"
                      >
                        ↻
                      </button>
                    </div>
                  )}
                </div>

                {/* Camera 2 Viewport / Stream */}
                <div
                  style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    background: '#05070a',
                  }}
                >
                  {secondaryDevice ? (
                    <>
                      {/* When view is NOT swapped: show stream2 here normally */}
                      {/* When view IS swapped: show primary stream here instead  */}
                      {viewSwapped ? (
                        <div style={{ position: 'absolute', inset: 0 }}>
                          <CameraStream src="/api/camera/stream" withMode={false} />
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: stream2Error ? 'none' : 'block',
                            }}
                          >
                            <CameraStream
                              key={stream2Key}
                              src="/api/camera/stream2"
                              withMode={false}
                              onError={() => setStream2Error(true)}
                              onFrame={() => setStream2Error(false)}
                            />
                          </div>
                          {stream2Error && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '8px',
                                color: '#94a3b8',
                                fontSize: '12px',
                                textAlign: 'center',
                                padding: '16px',
                              }}
                            >
                              <span style={{ fontSize: '28px', opacity: 0.5 }}>📷</span>
                              <span>กำลังเชื่อมต่อกล้องตัวที่ 2 ({secondaryDevice.serial})…</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setStream2Key(Date.now())
                                  setStream2Error(false)
                                }}
                                style={{
                                  marginTop: '4px',
                                  background: '#2563eb',
                                  border: 'none',
                                  color: '#fff',
                                  borderRadius: '6px',
                                  padding: '5px 12px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                ลองใหม่ (Retry)
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        color: '#475569',
                        userSelect: 'none',
                      }}
                    >
                    </div>
                  )}
                </div>
              </div>

              {/* ช่องขวาล่าง - D-pad + O-pad */}
              <div
                className="carddd"
                style={{
                  flex: 1,
                  minHeight: '250px',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '40px',
                }}
              >
                {/* o-pad ด้านซ้าย */}
                <nav className="o-pad">
                  <a
                    className="up"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      console.log('UP')
                    }}
                  />
                  <a
                    className="right"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      console.log('RIGHT')
                    }}
                  />
                  <a
                    className="down"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      console.log('DOWN')
                    }}
                  />
                  <a
                    className="left"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      console.log('LEFT')
                    }}
                  />
                </nav>

                {/* ด้านขวา */}
                <div className="ud-pad">
                  <button className="ud-btn up" onClick={() => console.log("UP")}>
                    <span></span>
                  </button>

                  <button className="ud-btn down" onClick={() => console.log("DOWN")}>
                    <span></span>
                  </button>
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
