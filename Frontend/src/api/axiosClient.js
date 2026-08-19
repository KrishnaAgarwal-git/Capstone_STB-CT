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
    // Normalise the error shape so callers can always read err.message
    const message =
      err.response?.data?.message || err.message || "Something went wrong. Please try again.";
    return Promise.reject(new Error(message));
  }
);

export default axiosClient;
