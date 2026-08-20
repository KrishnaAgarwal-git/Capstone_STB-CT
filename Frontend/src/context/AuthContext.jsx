import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi, configApi } from "../api";
// Note: this project uses react-router-dom (v7), not the standalone
// "react-router" package. Every component below imports from
// "react-router-dom" to match Frontend/package.json.

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("stbct_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [config, setConfig] = useState({ creditsPerHour: 10, serviceCategories: [], transportModes: [] });
  const [loading, setLoading] = useState(true);

  const persist = (token, u) => {
    localStorage.setItem("stbct_token", token);
    localStorage.setItem("stbct_user", JSON.stringify(u));
    setUser(u);
  };

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await authApi.login({ email, password });
    persist(token, u);
    return u;
  }, []);

  /** Used by VerifyEmail.jsx once /auth/verify-email returns a fresh token+user. */
  const establishSession = useCallback((token, u) => {
    persist(token, u);
    return u;
  }, []);

  const register = useCallback(async (payload) => {
    // Registration now requires email verification - no token is issued yet.
    // Returns { requiresVerification: true, email, group } for the caller
    // (SignUp.jsx) to redirect to the check-email page.
    return authApi.register(payload);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("stbct_token");
    localStorage.removeItem("stbct_user");
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await authApi.me();
      localStorage.setItem("stbct_user", JSON.stringify(u));
      setUser(u);
      return u;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Config is supplementary (business constants for labels/dropdowns) and
    // must NEVER gate rendering - fetch it in the background and let the UI
    // paint with the defaults in the meantime. Blocking on it here was a
    // direct cause of the loading screen flashing on every page load.
    configApi
      .get()
      .then((cfg) => { if (!cancelled) setConfig(cfg); })
      .catch(() => { /* backend not up yet - defaults already in state */ });

    const token = localStorage.getItem("stbct_token");

    // No token = definitively logged out. Resolve synchronously so
    // ProtectedRoute can redirect immediately instead of flashing a spinner.
    if (!token) {
      setUser(null);
      setLoading(false);
      return () => { cancelled = true; };
    }

    // We have a token AND a cached user (read during useState init), so the
    // UI can render the real, correct page straight away. The /auth/me call
    // below still runs to validate the token and refresh the profile, but it
    // happens silently in the background - the user never sees a loading
    // state for it. This is what removes the flicker on navigation.
    const cachedUser = localStorage.getItem("stbct_user");
    if (cachedUser) setLoading(false);

    authApi
      .me()
      .then(({ user: u }) => {
        if (cancelled) return;
        localStorage.setItem("stbct_user", JSON.stringify(u));
        setUser(u);
      })
      .catch(() => {
        // Token is invalid/expired - clear it and drop to logged-out state.
        if (cancelled) return;
        localStorage.removeItem("stbct_token");
        localStorage.removeItem("stbct_user");
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, config, loading, login, register, logout, refreshUser, establishSession, isAuthed: Boolean(user) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
