// Single source of truth for business rules.
// The frontend reads these from GET /api/v1/config - never hardcode them there.

export const CREDITS_PER_HOUR = 10;

export const STARTING_CREDITS = 50; // 5 hours, so a new user can transact on day one
export const MAX_CREDIT_BALANCE = 400; // 40 hours - prevents hoarding
export const CONFIRMATION_TIMEOUT_HOURS = 72;
export const MAX_HOURS_PER_DAY = 8; // anti-fraud: nobody delivers 30h in a day

// Collusion guard
export const PAIR_DOMINANCE_THRESHOLD = 0.5; // >50% of a user's txns with one partner
export const MAX_PAIR_TXNS_PER_WEEK = 5;

export const SERVICE_CATEGORIES = [
  { key: "tutoring_in_person", label: "Tutoring (in person)", linked: false },
  { key: "tutoring_remote", label: "Tutoring (remote)", linked: true },
  { key: "home_repair", label: "Home repair / maintenance", linked: true },
  { key: "ride_share", label: "Ride share", linked: true },
  { key: "shared_errand", label: "Shared errand", linked: true },
  { key: "digital_help", label: "Digital help", linked: true },
  { key: "general_assistance", label: "General assistance", linked: false },
];

export const SERVICE_CATEGORY_KEYS = SERVICE_CATEGORIES.map((c) => c.key);

export const CARBON_DOMAINS = ["transportation", "electricity", "food", "consumption"];

export const TRANSPORT_MODES = [
  { key: "private_car", label: "Private car" },
  { key: "two_wheeler", label: "Two wheeler" },
  { key: "auto_rickshaw", label: "Auto rickshaw" },
  { key: "public_transit", label: "Public transit" },
  { key: "shared_ride", label: "Shared ride" },
  { key: "electric_vehicle", label: "Electric vehicle" },
  { key: "walk_cycle", label: "Walk / cycle" },
];

export const TRANSPORT_MODE_KEYS = TRANSPORT_MODES.map((m) => m.key);

export const TRANSACTION_STATUS = {
  REQUESTED: "REQUESTED",
  ACCEPTED: "ACCEPTED",
  EXECUTED: "EXECUTED",
  COMPLETED: "COMPLETED",
  DISPUTED: "DISPUTED",
  CANCELLED: "CANCELLED",
};

// Gamification
export const POINTS = {
  SERVICE_COMPLETED: 20,
  CARBON_LOGGED: 5,
  PER_KG_CO2_SAVED: 2,
  NEW_COUNTERPARTY_BONUS: 15, // rewards diversity, not volume
};
