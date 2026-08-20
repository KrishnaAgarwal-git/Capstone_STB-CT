import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";

const axiosClient = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach the JWT to every request
axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("stbct_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// One place to handle expired sessions, so no component needs its own 401 logic
axiosClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    if (status === 401) {
      localStorage.removeItem("stbct_token");
      localStorage.removeItem("stbct_user");
      if (!window.location.pathname.match(/^\/(login|SignUp|)$/i)) {
        window.location.href = "/login";
      }
    }
    // Normalise the error shape so callers can always read err.message,
    // and preserve any application-level error code (e.g. "EMAIL_NOT_VERIFIED")
    // the backend attaches, so components can react to specific error types.
    const message =
      err.response?.data?.message || err.message || "Something went wrong. Please try again.";
    const normalised = new Error(message);
    normalised.code = err.response?.data?.code;
    normalised.status = status;
    return Promise.reject(normalised);
  }
);

export default axiosClient;
