import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Aurora from './Aurora';
import AuthTopBar from './AuthTopBar';
import { spotlightMove } from '../utils/spotlight';
import { authApi } from '../api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) return toast.error('This reset link is missing its token.');
    if (password.length < 6) return toast.error('Password must be at least 6 characters.');
    if (password !== confirm) return toast.error('Passwords do not match.');

    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      toast.success('Password updated — sign in with your new password.');
      navigate('/login', { replace: true });
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
          <h2 className="login-heading">Choose a new password</h2>
          <p className="login-subheading">Make it at least 6 characters.</p>

          {!token && (
            <div className="login-message login-message--error">
              This link is missing its token — request a new one from the forgot-password page.
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="password" className="form-label">New password</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input id="password" type={showPassword ? 'text' : 'password'}
                  className="form-input form-input--with-icon" placeholder="At least 6 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((p) => !p)}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirm" className="form-label">Confirm password</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input id="confirm" type={showPassword ? 'text' : 'password'}
                  className="form-input form-input--with-icon" placeholder="Type it again"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
            </div>

            <button type="submit" className="submit-button" disabled={loading || !token}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>

          <p className="login-footer">
            <Link to="/login" className="login-link">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
