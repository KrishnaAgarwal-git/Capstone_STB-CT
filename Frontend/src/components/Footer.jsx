import { useState } from "react";
import { Link } from "react-router-dom";
import { FaTwitter, FaLinkedin, FaArrowRight } from "react-icons/fa";
import logo1 from "../assets/logo1.png";

const productLinks = [
  { label: "Carbon Calculator", to: "/calculator" },
  { label: "Time Bank Credits", to: "/marketplace" },
  { label: "AI Recommendations", to: "/insights" },
  { label: "Sustainability Dashboard", to: "/dashboard" },
  { label: "Leaderboard", to: "/leaderboard" },
];

const resourceLinks = [
  { label: "Documentation", href: "#docs" },
  { label: "API Reference", href: "#api" },
  { label: "Community", href: "#community" },
  { label: "Sustainability Blog", href: "#blog" },
  { label: "Help Center", href: "#help" },
];

const Footer = () => {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e) => {
    e.preventDefault();
    setSubscribed(true);
    setEmail("");
    window.setTimeout(() => setSubscribed(false), 3000);
  };

  return (
    <footer className="cc-footer" id="contact">
      <div className="cc-footer__container">
        <div className="cc-footer__grid">
          {/* Brand */}
          <div className="cc-footer__brand">
            <img src={logo1} alt="CarbonClock logo" className="cc-footer__logo" />
            <p className="cc-footer__about">
              Track your carbon footprint, share time bank credits, and get
              AI-powered recommendations for a more sustainable future.
            </p>
            <div className="cc-footer__socials">
              <a href="https://twitter.com" target="_blank" rel="noreferrer" aria-label="Twitter" className="cc-footer__social">
                <FaTwitter size={16} />
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="cc-footer__social">
                <FaLinkedin size={16} />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="cc-footer__heading">Product</h3>
            <ul className="cc-footer__list">
              {productLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} className="cc-footer__link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="cc-footer__heading">Resources</h3>
            <ul className="cc-footer__list">
              {resourceLinks.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="cc-footer__link">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Stay Updated */}
          <div>
            <h3 className="cc-footer__heading">Stay Updated</h3>
            <p className="cc-footer__about">
              {subscribed
                ? "Thanks — you're on the list."
                : "Join our newsletter for the latest sustainability insights and product updates."}
            </p>
            <form onSubmit={handleSubscribe} className="cc-footer__form">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="cc-footer__input"
              />
              <button
                type="submit"
                aria-label="Subscribe"
                className="cc-footer__submit"
              >
                <FaArrowRight size={16} />
              </button>
            </form>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="cc-footer__bottom">
          <p>© {new Date().getFullYear()} CarbonClock Inc. All rights reserved.</p>
          <div className="cc-footer__legal">
            <a href="#privacy" className="cc-footer__link">Privacy Policy</a>
            <a href="#terms" className="cc-footer__link">Terms of Service</a>
            <a href="#cookies" className="cc-footer__link">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
