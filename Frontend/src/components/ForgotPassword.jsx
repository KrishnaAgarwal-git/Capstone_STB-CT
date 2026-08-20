import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Aurora from './Aurora';
import AuthTopBar from './AuthTopBar';
import { spotlightMove } from '../utils/spotlight';
import { authApi } from '../api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Enter your email address.');
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
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
              <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2.5" />
              <path d="M32 14C32 14 18 24 18 36C18 43.7 24.3 50 32 50C39.7 50 46 43.7 46 36C46 24 32 14 32 14Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M26 38C26 42 28.5 46 32 46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="brand-title">CarbonClock</h1>
        </Link>

        <div className="login-card spotlight" onMouseMove={spotlightMove}>
          <h2 className="login-heading">Forgot your password?</h2>
          <p className="login-subheading">
            {sent
              ? 'If an account exists for that email, a reset link is on its way.'
              : "Enter your email and we'll send you a reset link."}
          </p>

          {!sent && (
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="email" className="form-label">Email</label>
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <input id="email" type="email" className="form-input form-input--with-icon"
                    placeholder="you@email.com" value={email}
                    onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
              </div>

              <button type="submit" className="submit-button" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="login-footer">
            <Link to="/login" className="login-link">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
