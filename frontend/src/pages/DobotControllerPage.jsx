import React, { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const STEP_VALUES = [0.1, 1, 5, 10]
const CARTESIAN_AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ']
const JOINT_AXES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']

const JogGroup = ({ axes, onMove }) => (
  <div className="jog-panel">
    {axes.map((axis) => (
      <div key={axis} className="jog-row">
        <button
          id={`jog-${axis}-minus`}
          className="jog-pill jog-pill--minus"
          onClick={() => onMove(axis, '-')}
          title={`Decrease ${axis}`}
        >
          <span className="jog-axis-badge">{axis}</span>
          <span className="jog-sign">-</span>
        </button>
        <button
          id={`jog-${axis}-plus`}
          className="jog-pill jog-pill--plus"
          onClick={() => onMove(axis, '+')}
          title={`Increase ${axis}`}
        >
          <span className="jog-axis-badge">{axis}</span>
          <span className="jog-sign">+</span>
        </button>
      </div>
    ))}
  </div>
)

const DobotControllerPage = () => {
  const [stepValue, setStepValue] = useState(1)
  const [pos, setPos]       = useState({ X: 0, Y: 0, Z: 150, RX: 0, RY: 0, RZ: 0 })
  const [joints, setJoints] = useState({ J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 })
  const [lastMoved, setLastMoved] = useState(null)

  // Receive TCP position + joints from the 3D viewer iframe
  useEffect(() => {
    const handleMessage = (e) => {
      if (!e.data || e.data.type !== 'tcpUpdate') return
      const { x, y, z, rx, ry, rz, joints: j } = e.data
      setPos((prev) => ({
        ...prev,
        X:  x  ?? prev.X,
        Y:  y  ?? prev.Y,
        Z:  z  ?? prev.Z,
        RX: rx ?? prev.RX,
        RY: ry ?? prev.RY,
        RZ: rz ?? prev.RZ,
      }))
      if (Array.isArray(j) && j.length === 6) {
        setJoints({
          J1: j[0], J2: j[1], J3: j[2],
          J4: j[3], J5: j[4], J6: j[5],
        })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleEmergency = () => {
    // TODO: Call POST /api/robot/emergency-stop
    alert('EMERGENCY STOP!')
  }

  const handleMove = (axis, direction) => {
    const delta = direction === '+' ? stepValue : -stepValue
    setLastMoved(`${axis}${direction}`)
    if (axis.startsWith('J')) {
      setJoints((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    } else {
      setPos((prev) => ({ ...prev, [axis]: +(prev[axis] + delta).toFixed(2) }))
    }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Dobot Controller" onEmergency={handleEmergency} />
        <div className="page-content dobot-page">
          <div className="dobot-layout">

            {/* ── Left: 3D Viewer Area ── */}
            <div className="dobot-viewer-wrap">
              <div className="dobot-3d-box" style={{ padding: 0, overflow: 'hidden' }}>
                <iframe
                  src="/robot-viewer.html"
                  title="Robot Arm 3D Viewer"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                    borderRadius: '16px',
                  }}
                  allow="accelerometer"
                />
                <button
                  className="dobot-fullscreen-btn"
                  title="Fullscreen"
                  onClick={() => window.open('/robot-viewer.html', '_blank')}
                >
                  ⛶
                </button>
              </div>
            </div>

            {/* ── Right: Control Panel Box ── */}
            <div className="ctrl-box">

              {/* Header */}
              <div className="ctrl-box-header">
                <div className="ctrl-box-title-wrap">
                  <span className="ctrl-box-title">Control Panel</span>
                </div>
                {lastMoved && (
                  <span className="ctrl-last-action">
                    Last: <strong>{lastMoved}</strong>
                  </span>
                )}
              </div>

              {/* Coordinate Readout */}
              <div className="coord-bar">
                <div className="coord-group">
                  <div className="coord-group-header">
                    <span className="coord-group-dot coord-group-dot--cartesian" />
                    <span className="coord-group-label">Cartesian (mm / deg)</span>
                  </div>
                  <div className="coord-items">
                    {Object.entries(pos).map(([k, v]) => (
                      <div key={k} className="coord-item">
                        <span className="coord-axis">{k}</span>
                        <span className="coord-val">{v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="coord-group">
                  <div className="coord-group-header">
                    <span className="coord-group-dot coord-group-dot--joint" />
                    <span className="coord-group-label">Joint Angles (deg)</span>
                  </div>
                  <div className="coord-items">
                    {Object.entries(joints).map(([k, v]) => (
                      <div key={k} className="coord-item">
                        <span className="coord-axis">{k}</span>
                        <span className="coord-val">{v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step Value */}
              <div className="step-row">
                <div className="step-row-label-wrap">
                  <span className="step-row-label">Step Value</span>
                  <span className="step-row-sub">Distance per jog</span>
                </div>
                <div className="step-pills-wrap">
                  {STEP_VALUES.map((val) => (
                    <button
                      key={val}
                      className={`step-pill ${stepValue === val ? 'active' : ''}`}
                      onClick={() => setStepValue(val)}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Jog Panels */}
              <div className="jog-dual">
                <div className="jog-box">
                  <div className="jog-box-header">
                    <span className="jog-box-title">Cartesian Control</span>
                  </div>
                  <JogGroup axes={CARTESIAN_AXES} onMove={handleMove} />
                </div>
                <div className="jog-box">
                  <div className="jog-box-header">
                    <span className="jog-box-title">Joint Control</span>
                  </div>
                  <JogGroup axes={JOINT_AXES} onMove={handleMove} />
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DobotControllerPage
