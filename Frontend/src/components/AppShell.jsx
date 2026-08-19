import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: "🌿" },
  { to: "/calculator", label: "Calculator", icon: "🧮" },
  { to: "/marketplace", label: "Time Bank", icon: "⏳" },
  { to: "/insights", label: "AI Insights", icon: "✨" },
  { to: "/leaderboard", label: "Leaderboard", icon: "🏆" },
];

/**
 * Shared shell for every authenticated page - reproduces the orbs, noise
 * overlay, and nav language from the original Dashboard exactly, then
 * extends the nav with real links so every page feels like one product
 * instead of a dashboard bolted onto four different ones.
 */
export default function AppShell({ children, wide = false }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const initial = (user?.firstName || "?").charAt(0).toUpperCase();

  return (
    <div className="cc-root">
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className={wide ? "page page--wide" : "page"}>
        <nav>
          <Link to="/dashboard" className="logo">
            <div className="logo-icon">🌿</div>
            CarbonClock
          </Link>

          <div className="nav-links desktop-only">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`nav-link${location.pathname === l.to ? " is-active" : ""}`}
              >
                <span className="nav-link-icon">{l.icon}</span>
                {l.label}
              </Link>
            ))}
          </div>

          <div className="nav-right">
            <span className="nav-credit-pill" title="Your time credit balance">
              <span className="nav-dot" />
              {user?.credits ?? 0} credits
            </span>
            <div className="nav-mini-avatar" title={user?.name || "Account"}>
              {initial}
            </div>
            <button className="nav-logout" onClick={handleLogout} aria-label="Sign out">
              ⏻
            </button>
          </div>
        </nav>

        <div className="nav-links-mobile mobile-only">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`nav-link${location.pathname === l.to ? " is-active" : ""}`}
            >
              <span className="nav-link-icon">{l.icon}</span>
              {l.label}
            </Link>
          ))}
        </div>

        {children}

        <footer>CarbonClock — TRACK · ACT · SUSTAIN</footer>
      </div>
    </div>
  );
}
