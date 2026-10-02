import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CameraViewPage from './pages/CameraViewPage'
import DrawingModePage from './pages/DrawingModePage'
import DobotControllerPage from './pages/DobotControllerPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import LogsPage from './pages/LogsPage'
import CameraStream from './components/CameraStream'
import RequireAuth from './components/RequireAuth'
import ApiErrorBanner from './components/ApiErrorBanner'

function App() {
  return (
    <BrowserRouter>
      <ApiErrorBanner />
      <div id="camera-stream-dock" style={{ display: 'none' }}>
        <CameraStream id="global-camera-stream" />
      </div>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/camera" element={<RequireAuth><CameraViewPage /></RequireAuth>} />
        <Route path="/drawing" element={<RequireAuth><DrawingModePage /></RequireAuth>} />
        <Route path="/dobot" element={<RequireAuth><DobotControllerPage /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SystemSettingsPage /></RequireAuth>} />
        <Route path="/logs" element={<RequireAuth><LogsPage /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
