import { useState } from 'react';
import { useLocation, Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Aurora from './Aurora';
import AuthTopBar from './AuthTopBar';
import { spotlightMove } from '../utils/spotlight';
import { authApi } from '../api';

export default function CheckEmail() {
  const location = useLocation();
  const email = location.state?.email;
  const [resending, setResending] = useState(false);

  if (!email) return <Navigate to="/SignUp" replace />;

  const resend = async () => {
    setResending(true);
    try {
      await authApi.resendVerification(email);
      toast.success('Verification email sent again — check your inbox.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="login-page">
      <div className='bg1-container'>
        <Aurora colorStops={["#364320", "#556e2e", "#8aa550"]} blend={0.5} amplitude={1} speed={1} />
      </div>

      <AuthTopBar />

      <div className="login-container">
        <Link to="/" className="login-brand" aria-label="Back to home">
          <div className="brand-icon">
            <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 16h48v32H8z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M8 16l24 18 24-18" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="brand-title">CarbonClock</h1>
        </Link>

        <div className="login-card spotlight" onMouseMove={spotlightMove}>
          <h2 className="login-heading">Check your email</h2>
          <p className="login-subheading">
            We sent a verification link to<br /><strong>{email}</strong>
          </p>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', margin: '20px 0' }}>
            Click the link in that email to verify your account and sign in. If you don't see it,
            check your spam folder — or request a new one below.
          </p>

          <button className="submit-button" onClick={resend} disabled={resending}>
            {resending ? 'Sending…' : 'Resend verification email'}
          </button>

          <p className="login-footer">
            Already verified? <Link to="/login" className="login-link">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
