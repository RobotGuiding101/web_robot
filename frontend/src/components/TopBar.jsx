import React, { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

const TopBar = ({ title, onEmergency }) => {
  const [ip, setIp] = useState(
    () => localStorage.getItem('robot_ip') || '192.168.10.110'
  )
  const [emergencyActive, setEmergencyActive] = useState(false)

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

  const handleEmergencyClick = async () => {
    setEmergencyActive(true)
    try {
      // Direct emergency stop call to backend (halts robot & clears queues)
      await Promise.allSettled([
        apiFetch('/api/map/emergency', { method: 'POST' }),
        apiFetch('/api/robot/emergency-stop', { method: 'POST' }),
        apiFetch('/api/map/move_sequence/stop', { method: 'POST' }),
      ])
    } catch { /* ignore */ }

    // Execute page-level onEmergency callback if provided
    if (typeof onEmergency === 'function') {
      try { onEmergency() } catch { /* ignore */ }
    }

    setTimeout(() => setEmergencyActive(false), 3000)
  }

  return (
    <div className="topbar">
      <span className="page-title">{title}</span>
      <div className="topbar-right">
        <div className="topbar-ip-badge" title="Connected IP Address">
          <span className="topbar-ip-dot" />
          <span className="topbar-ip-label">IP:</span>
          <span className="topbar-ip-val">{ip}</span>
        </div>
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
