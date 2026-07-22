import React from 'react'

const TopBar = ({ title, ip = '192.168.1.100', onEmergency }) => {
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
