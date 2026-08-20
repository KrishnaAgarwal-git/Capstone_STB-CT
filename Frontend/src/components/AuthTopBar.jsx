import { Link } from "react-router-dom";
import navLogo from "../assets/navLogo.png";

/**
 * Minimal top bar for the auth flow (sign in, sign up, verify, reset).
 *
 * Deliberately NOT the full PillNav: an auth screen is a single-purpose,
 * focused task, and every serious product (Stripe, Linear, Vercel, Notion)
 * strips navigation there so nothing competes with the form. What it DOES
 * keep is the brand mark and a way back to the marketing site - so the page
 * still reads as part of CarbonClock rather than a detached form, which was
 * the actual complaint.
 */
export default function AuthTopBar() {
  return (
    <div className="auth-topbar">
      <Link to="/" className="auth-topbar-brand" aria-label="Back to CarbonClock home">
        <img src={navLogo} alt="" className="auth-topbar-logo" />
        <span>CarbonClock</span>
      </Link>
      <Link to="/" className="auth-topbar-back">
        <span aria-hidden="true">←</span> Back to site
      </Link>
    </div>
  );
}
