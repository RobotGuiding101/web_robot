import React, { useState, useEffect } from 'react'

const TopBar = ({ title, onEmergency }) => {
  const [ip, setIp] = useState(
    () => localStorage.getItem('robot_ip') || '192.168.10.110'
  )

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

  return (
    <div className="topbar">
      <span className="page-title">{title}</span>
      <div className="topbar-right">
        <div className="topbar-ip-badge" title="Connected IP Address">
          <span className="topbar-ip-dot" />
          <span className="topbar-ip-label">IP:</span>
          <span className="topbar-ip-val">{ip}</span>
        </div>
        <button className="emergency-btn" onClick={onEmergency}>
          EMERGENCY
        </button>
      </div>
    </div>
  )
}

export default TopBar
