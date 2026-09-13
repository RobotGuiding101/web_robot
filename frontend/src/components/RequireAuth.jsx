import { Navigate } from 'react-router-dom'
import { isTokenValid } from '../lib/api'

const RequireAuth = ({ children }) => {
  if (!isTokenValid()) return <Navigate to="/login" replace />
  return children
}

export default RequireAuth
