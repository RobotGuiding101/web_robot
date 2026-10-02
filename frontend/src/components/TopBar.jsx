import React, { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { useJointsSocket } from '../lib/useJointsSocket'

const TopBar = ({ title, onEmergency, showConnect = true }) => {
  const [ip, setIp] = useState(
    () => localStorage.getItem('robot_ip') || '192.168.10.110'
  )
  const [emergencyActive, setEmergencyActive] = useState(false)
  const [robotConnected, setRobotConnected] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectMsg, setConnectMsg] = useState(null) // 'ok' | 'error' | null

  useEffect(() => {
    const onIpChange = () => {
      setIp(localStorage.getItem('robot_ip') || '192.168.10.110')
    }
    window.addEventListener('robot_ip_changed', onIpChange)
    window.addEventListener('storage', (e) => {
      if (e.key === 'robot_ip') onIpChange()
    })
    return () => {
      window.removeEventListener('robot_ip_changed', onIpChange)
      window.removeEventListener('storage', onIpChange)
    }
  }, [])

  // Connection state comes from the shared /ws/joints feed instead of polling
  // /api/map/status on every page.
  const joints = useJointsSocket()
  useEffect(() => {
    if (joints && typeof joints.connected === 'boolean') setRobotConnected(joints.connected)
  }, [joints])

  // ── Spacebar → Emergency Stop ─────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== 'Space') return
      // ไม่ fire ถ้าผู้ใช้กำลังพิมพ์ใน input / textarea / select / contenteditable
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.target.isContentEditable) return
      e.preventDefault()
      handleEmergencyClick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEmergencyClick = async () => {
    setEmergencyActive(true)
    try {
      await Promise.allSettled([
        apiFetch('/api/map/emergency', { method: 'POST' }),
        apiFetch('/api/robot/emergency-stop', { method: 'POST' }),
        apiFetch('/api/map/move_sequence/stop', { method: 'POST' }),
      ])
    } catch { /* ignore */ }

    if (typeof onEmergency === 'function') {
      try { onEmergency() } catch { /* ignore */ }
    }

    setTimeout(() => setEmergencyActive(false), 3000)
  }

  const handleConnect = async () => {
    if (connectLoading) return
    setConnectLoading(true)
    setConnectMsg(null)
    try {
      const robotIp = localStorage.getItem('robot_ip') || '192.168.10.110'
      const dashPort = parseInt(localStorage.getItem('robot_dashboard_port') || '29999', 10)
      const movePort = parseInt(localStorage.getItem('robot_move_port') || '30003', 10)
      const res = await apiFetch('/api/map/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: robotIp, dashboard_port: dashPort, move_port: movePort }),
      })
      const data = await res.json()
      setRobotConnected(!!data.ok)
      setConnectMsg(data.ok ? 'ok' : 'error')
    } catch {
      setRobotConnected(false)
      setConnectMsg('error')
    } finally {
      setConnectLoading(false)
      setTimeout(() => setConnectMsg(null), 2500)
    }
  }

  return (
    <div className="topbar">
      <span className="page-title">{title}</span>

      <div className="topbar-right">
        <div className="topbar-ip-badge" title="Connected IP Address">
          <span className={`topbar-ip-dot${robotConnected ? ' topbar-ip-dot--on' : ''}`} />
          <span className="topbar-ip-label">IP:</span>
          <span className="topbar-ip-val">{ip}</span>
        </div>
        {showConnect && (
          <button
            className={`topbar-connect-btn${robotConnected ? ' topbar-connect-btn--connected' : ''}${connectMsg === 'error' ? ' topbar-connect-btn--error' : ''}`}
            onClick={handleConnect}
            disabled={connectLoading}
            title={robotConnected ? `Connected to ${ip} — click to reconnect` : `Connect to robot at ${ip}`}
          >
            <span className={`topbar-connect-dot${robotConnected ? ' topbar-connect-dot--on' : ''}`} />
            {connectLoading
              ? 'Connecting…'
              : connectMsg === 'ok'
                ? 'Connected ✓'
                : connectMsg === 'error'
                  ? 'Failed ✕'
                  : robotConnected
                    ? 'Connected'
                    : 'Connect'}
          </button>
        )}
        <button
          className={`emergency-btn ${emergencyActive ? 'emergency-btn--active' : ''}`}
          onClick={handleEmergencyClick}
          title="Emergency Stop: Halt robot immediately and cancel all queued commands"
        >
          {emergencyActive ? 'STOPPING...' : 'EMERGENCY'}
        </button>
      </div>
    </div>
  )
}

export default TopBar
