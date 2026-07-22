import React from 'react'
import { useNavigate } from 'react-router-dom'

const LoginPage = () => {
  const navigate = useNavigate()

  const handleLogin = (e) => {
    e.preventDefault()
    // TODO: Call POST /api/auth/login with username & password
    navigate('/dashboard')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">🦾</div>
        <h1 className="login-title">Robot Arm System Login</h1>
        <p className="login-subtitle">เข้าสู่ระบบเพื่อเริ่มควบคุมแขนกล</p>

        <form className="login-form" onSubmit={handleLogin}>
          <input id="username" type="text" placeholder="Username" required />
          <input id="password" type="password" placeholder="Password" required />
          <button id="login-submit-btn" type="submit" className="login-btn">
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
