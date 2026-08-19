import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Aurora from './Aurora';
import { useAuth } from '../context/AuthContext';

const REGIONS = [
  { key: 'IN-PB', label: 'Punjab' },
  { key: 'IN-DL', label: 'Delhi' },
  { key: 'IN-MH', label: 'Maharashtra' },
  { key: 'IN-KA', label: 'Karnataka' },
  { key: 'IN-TN', label: 'Tamil Nadu' },
];

function SignUp() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState('IN-PB');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!firstName || !lastName || !email || !password) {
      setMessage({ type: 'error', text: 'Please fill in all fields.' });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }

    setLoading(true);
    try {
      const user = await register({ firstName, lastName, email, password, region });
      toast.success(`Account created. You start with ${user.credits} credits.`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => setShowPassword((prev) => !prev);

  return (
    <div className="signup-page">
      <div className='bg1-container'>
        <Aurora colorStops={["#364320", "#556e2e", "#8aa550"]} blend={0.5} amplitude={1} speed={1} />
      </div>

      <div className="signup-container">
        <div className="signup-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2.5" />
              <path d="M32 14C32 14 18 24 18 36C18 43.7 24.3 50 32 50C39.7 50 46 43.7 46 36C46 24 32 14 32 14Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M26 38C26 42 28.5 46 32 46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="brand-title">CarbonClock</h1>
          <p className="brand-subtitle">Sustainable Time Bank with Carbon Tracking</p>
        </div>

        <div className="signup-card">
          <h2 className="signup-heading">Create Account</h2>
          <p className="signup-subheading">Join the movement for a greener future</p>

          {message && (
            <div className={`signup-message signup-message--${message.type}`}>{message.text}</div>
          )}

          <form onSubmit={handleSubmit} className="signup-form">
            <div className="name-row">
              <div className="form-group">
                <label htmlFor="firstName" className="form-label">First Name</label>
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input id="firstName" type="text" className="form-input form-input--with-icon"
                    placeholder="First Name" value={firstName}
                    onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="lastName" className="form-label">Last Name</label>
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input id="lastName" type="text" className="form-input form-input--with-icon"
                    placeholder="Last Name" value={lastName}
                    onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                </div>
              </div>
            </div>

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

            <div className="form-group">
              <label htmlFor="password" className="form-label">Password</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input id="password" type={showPassword ? 'text' : 'password'}
                  className="form-input form-input--with-icon" placeholder="At least 6 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password" />
                <button type="button" className="password-toggle" onClick={togglePasswordVisibility} aria-label="Toggle password visibility">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="region" className="form-label">Region</label>
              <p className="form-hint">Used to apply the correct electricity grid mix to your carbon estimates.</p>
              <select id="region" className="form-input" value={region} onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>

            <button type="submit" className="submit-button" disabled={loading}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <p className="signup-footer">
            Already have an account? <Link to="/login" className="signup-link">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default SignUp;
