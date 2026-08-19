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

  const register = useCallback(async (payload) => {
    const { token, user: u } = await authApi.register(payload);
    persist(token, u);
    return u;
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

    const boot = async () => {
      try {
        const cfg = await configApi.get();
        if (!cancelled) setConfig(cfg);
      } catch {
        // Backend not up yet - fall back to defaults rather than blocking the UI
      }

      const token = localStorage.getItem("stbct_token");
      if (token) {
        try {
          const { user: u } = await authApi.me();
          if (!cancelled) {
            localStorage.setItem("stbct_user", JSON.stringify(u));
            setUser(u);
          }
        } catch {
          if (!cancelled) {
            localStorage.removeItem("stbct_token");
            localStorage.removeItem("stbct_user");
            setUser(null);
          }
        }
      }
      if (!cancelled) setLoading(false);
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, config, loading, login, register, logout, refreshUser, isAuthed: Boolean(user) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
