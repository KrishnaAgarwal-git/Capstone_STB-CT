import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { isAuthed, loading } = useAuth();
  const location = useLocation();

  // This screen is only reached on a genuinely cold start (no cached user in
  // localStorage). Normal navigation resolves instantly from cache - see the
  // boot effect in AuthContext - so this should almost never flash.
  if (loading) {
    return (
      <div className="cc-root">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="app-boot">
          <div className="app-boot-mark">
            <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2.5" opacity="0.35" />
              <path d="M32 14C32 14 18 24 18 36C18 43.7 24.3 50 32 50C39.7 50 46 43.7 46 36C46 24 32 14 32 14Z"
                stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M26 38C26 42 28.5 46 32 46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <p className="app-boot-word">CarbonClock</p>
          <div className="app-boot-track"><div className="app-boot-bar" /></div>
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}
