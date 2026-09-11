import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CameraViewPage from './pages/CameraViewPage'
import DrawingModePage from './pages/DrawingModePage'
import DobotControllerPage from './pages/DobotControllerPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import CameraStream from './components/CameraStream'

function App() {
  return (
    <BrowserRouter>
      <div id="camera-stream-dock" style={{ display: 'none' }}>
        <CameraStream id="global-camera-stream" />
      </div>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/camera" element={<CameraViewPage />} />
        <Route path="/drawing" element={<DrawingModePage />} />
        <Route path="/dobot" element={<DobotControllerPage />} />
        <Route path="/settings" element={<SystemSettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
