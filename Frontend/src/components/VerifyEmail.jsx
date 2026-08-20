import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Aurora from './Aurora';
import AuthTopBar from './AuthTopBar';
import { spotlightMove } from '../utils/spotlight';
import { authApi } from '../api';
import { useAuth } from '../context/AuthContext';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');
  const { establishSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in the link.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { token: jwt, user } = await authApi.verifyEmail(token);
        if (cancelled) return;
        establishSession(jwt, user);
        setStatus('success');
        toast.success('Email verified — welcome!');
        setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setMessage(err.message);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

        <div className="login-card spotlight" style={{ textAlign: 'center' }} onMouseMove={spotlightMove}>
          {status === 'verifying' && (
            <>
              <h2 className="login-heading">Verifying your email…</h2>
              <p className="login-subheading">This will just take a second.</p>
            </>
          )}
          {status === 'success' && (
            <>
              <h2 className="login-heading">Email verified 🎉</h2>
              <p className="login-subheading">Taking you to your dashboard…</p>
            </>
          )}
          {status === 'error' && (
            <>
              <h2 className="login-heading">Verification failed</h2>
              <div className="login-message login-message--error">{message}</div>
              <p className="login-footer" style={{ marginTop: 16 }}>
                <Link to="/login" className="login-link">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
