import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PillNav from "./PillNav";
import navLogo from "../assets/navLogo.png";

/**
 * Shared shell for every authenticated page.
 *
 * The navigation here is the SAME PillNav component the landing page uses -
 * same GSAP circle-fill hover animation, same pill geometry, same logo
 * treatment - just pointed at the app's routes instead of the marketing
 * ones. Previously this file hand-rolled its own nav, which is the single
 * most obvious reason the app read as a different product the moment you
 * signed in. Using the real component means the two can never drift apart.
 */
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Calculator", href: "/calculator" },
  { label: "Time Bank", href: "/marketplace" },
  { label: "AI Insights", href: "/insights" },
  { label: "Leaderboard", href: "/leaderboard" },
];

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
        <header className="app-topbar">
          <PillNav
            logo={navLogo}
            logoAlt="CarbonClock"
            items={NAV_ITEMS}
            activeHref={location.pathname}
            className="app-nav"
            ease="power2.easeOut"
            baseColor="#cdd3ad"
            pillColor="#2a3217"
            hoveredPillTextColor="#1e280d"
            pillTextColor="#f4f5ec"
            initialLoadAnimation={false}
          />

          <div className="app-topbar-right">
            <span className="nav-credit-pill" title="Your time credit balance">
              <span className="nav-dot" />
              {user?.credits ?? 0} credits
            </span>
            <Link to="/profile" className="nav-mini-avatar" title={user?.name || "Account"}>
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}
            </Link>
            <button className="nav-logout" onClick={handleLogout} aria-label="Sign out" title="Sign out">
              ⏻
            </button>
          </div>
        </header>

        {children}

        <footer>CarbonClock — Track · Act · Sustain</footer>
      </div>
    </div>
  );
}
