import { Link, useLocation } from "react-router-dom";
import logo from "../assets/logo.png";
import StyledButton from './StyledButton';
import PillNav from './PillNav';
import navLogo from "../assets/navLogo.png";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";

/**
 * The site's top nav bar, extracted from Header so it can be reused on pages
 * that aren't the landing page (e.g. Contact) without also pulling in the
 * full hero banner. Header.jsx composes this + HeroSection for the home page.
 */
function SiteNav() {
  const { isAuthed } = useAuth();
  const location = useLocation();

  return (
    <header className="header-div">
      <div className="logo-container">
        <Link to="/">
          <img src={logo} alt="CarbonClock Logo" className="logo-img" />
        </Link>
      </div>

      <PillNav
        logo={navLogo}
        logoAlt="CarbonClock Logo"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Calculator', href: '/calculator' },
          { label: 'LeaderBoard', href: '/leaderboard' },
          { label: 'AI Insights', href: '/insights' },
          { label: 'Contact Us', href: '/contact' },
        ]}
        activeHref={location.pathname}
        className="custom-nav"
        ease="power2.easeOut"
        baseColor="#6b8a3a"
        pillColor="#000000"
        hoveredPillTextColor="#000000"
        pillTextColor="#FFFFFF"
        theme="color"
        initialLoadAnimation={true}
      />

      <Link to={isAuthed ? "/dashboard" : "/SignUp"} className="cc-btn cc-btn--hero">
          {isAuthed ? "Go to Dashboard" : "Start Tracking"}
          <ArrowRight size={18} />
      </Link>

      <StyledButton />
    </header>
  );
}

export default SiteNav;
