import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./routes/ProtectedRoute";

import Home from "./components/Home";
import SignUp from "./components/SignUp";
import Login from "./components/Login";
import CheckEmail from "./components/CheckEmail";
import VerifyEmail from "./components/VerifyEmail";
import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";
import Profile from "./components/Profile";
import Contact from "./pages/Contact";
import Dashboard from "./components/Dashboard";
import CarbonCalculator from "./components/CarbonCalculator";
import Marketplace from "./components/Marketplace";
import Insights from "./components/Insights";
import Leaderboard from "./components/Leaderboard";

function App() {
  return (
    <AuthProvider>
      <div>
        <Toaster
          position="top-right"
          gutter={8}
          toastOptions={{
            duration: 5000,
            style: {
              background: "rgba(11, 17, 13, 0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: "#d6ead8",
              fontSize: "14px",
              fontFamily: "Manrope, sans-serif",
              fontWeight: "500",
              padding: "12px 16px",
              borderRadius: "12px",
              border: "1px solid rgba(34,197,94,0.2)",
              boxShadow: "0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -2px rgba(0,0,0,0.3)",
            },
            success: {
              iconTheme: { primary: "#22c55e", secondary: "#04140a" },
              style: { borderLeft: "4px solid #22c55e" },
            },
            error: {
              iconTheme: { primary: "#f87171", secondary: "#fff" },
              style: { borderLeft: "4px solid #f87171" },
            },
          }}
        />

        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/SignUp" element={<SignUp />} />
          <Route path="/login" element={<Login />} />
          <Route path="/check-email" element={<CheckEmail />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/contact" element={<Contact />} />

          {/* App (authenticated) */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/calculator" element={<ProtectedRoute><CarbonCalculator /></ProtectedRoute>} />
          <Route path="/marketplace" element={<ProtectedRoute><Marketplace /></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
          <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

          {/* Legacy alias so any old /log links still resolve */}
          <Route path="/log" element={<Navigate to="/calculator" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthProvider>
  );
}

export default App;
