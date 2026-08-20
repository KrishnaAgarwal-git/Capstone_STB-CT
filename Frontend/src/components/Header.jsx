import SiteNav from "./SiteNav";
import HeroSection from "./HeroSection";

function Header() {
  return (
    <>
      <SiteNav />
      <div className="hero-fade-wrapper">
        <HeroSection />
      </div>
    </>
  );
}

export default Header;
