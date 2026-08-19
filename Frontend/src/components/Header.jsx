import { Link } from "react-router-dom";
import logo from "../assets/logo.png";
import StyledButton from './StyledButton';
import PillNav from './PillNav';
import navLogo from "../assets/navLogo.png";
import HeroSection from "./HeroSection";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";

function Header() {
  const { isAuthed } = useAuth();

  return (
    <>
    <header className="header-div">
      <div className="logo-container">
        <img src={logo} alt="CarbonClock Logo" className="logo-img" />
      </div>

      <PillNav
        logo={navLogo}
        logoAlt="CarbonClock Logo"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Calculator', href: '/calculator' },
          { label: 'LeaderBoard', href: '/leaderboard' },
          { label: 'AI Insights', href: '/insights' },
          { label: 'Contact Us', href: '#contact' },
        ]}
        activeHref="/"
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

    <div className="hero-fade-wrapper">
        <HeroSection/>
    </div>
    </>
  );
}

export default Header;
