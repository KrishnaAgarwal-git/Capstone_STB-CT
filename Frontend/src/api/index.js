import api from "./axiosClient";

const unwrap = (res) => res.data.data;

/* ---- Auth ---- */
export const authApi = {
  register: (payload) => api.post("/auth/register", payload).then(unwrap),
  login: (payload) => api.post("/auth/login", payload).then(unwrap),
  me: () => api.get("/auth/me").then(unwrap),
  updateProfile: (payload) => api.patch("/auth/profile", payload).then(unwrap),
};

/* ---- Config (business constants live on the server) ---- */
export const configApi = {
  get: () => api.get("/config").then(unwrap),
};

/* ---- Service listings ---- */
export const listingApi = {
  browse: (params) => api.get("/listings", { params }).then(unwrap),
  create: (payload) => api.post("/listings", payload).then(unwrap),
  remove: (id) => api.delete(`/listings/${id}`).then(unwrap),
};

/* ---- Transactions ---- */
export const transactionApi = {
  list: (status) => api.get("/transactions", { params: { status } }).then(unwrap),
  request: (payload) => api.post("/transactions", payload).then(unwrap),
  accept: (id) => api.patch(`/transactions/${id}/accept`).then(unwrap),
  execute: (id) => api.patch(`/transactions/${id}/execute`).then(unwrap),
  confirm: (id, payload) => api.patch(`/transactions/${id}/confirm`, payload || {}),
  dispute: (id, reason) => api.patch(`/transactions/${id}/dispute`, { reason }).then(unwrap),
  cancel: (id) => api.patch(`/transactions/${id}/cancel`).then(unwrap),
};

/* ---- Carbon ---- */
export const carbonApi = {
  summary: () => api.get("/carbon/summary").then(unwrap),
  history: (params) => api.get("/carbon/activities", { params }).then(unwrap),
  log: (payload) => api.post("/carbon/activities", payload).then(unwrap),
  reverse: (id, reason) => api.patch(`/carbon/activities/${id}/reverse`, { reason }).then(unwrap),
  generateRideCode: (payload) => api.post("/carbon/ride-code", payload).then(unwrap),
  verifyRideCode: (code) => api.post("/carbon/ride-code/verify", { code }).then(unwrap),
};

/* ---- Gamification ---- */
export const gamificationApi = {
  leaderboards: (groupId) => api.get("/leaderboards", { params: { groupId } }).then(unwrap),
  points: () => api.get("/points").then(unwrap),
  group: () => api.get("/group").then(unwrap),
  joinGroup: (inviteCode) => api.post("/group/join", { inviteCode }).then(unwrap),
};

/* ---- AI Insights ---- */
export const insightsApi = {
  get: () => api.get("/insights").then(unwrap),
};
