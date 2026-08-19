// Canonical storage units:
//   distance -> metres
//   energy   -> watt-hours
//   emissions-> grams CO2e
// Convert only at the API boundary. Nothing else should do unit maths.

export const kmToMetres = (km) => Math.round(Number(km) * 1000);
export const metresToKm = (m) => Number(m) / 1000;

export const kWhToWh = (kwh) => Math.round(Number(kwh) * 1000);
export const whToKWh = (wh) => Number(wh) / 1000;

export const kgToGrams = (kg) => Math.round(Number(kg) * 1000);
export const gramsToKg = (g) => Number((Number(g) / 1000).toFixed(3));

export const hoursToCredits = (hours, creditsPerHour) =>
  Math.round(Number(hours) * creditsPerHour);

export const creditsToHours = (credits, creditsPerHour) =>
  Number((Number(credits) / creditsPerHour).toFixed(2));

// Haversine distance in metres - fallback when the distance API is unavailable.
export const haversineMetres = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

// Road distance is longer than straight line - standard circuity factor.
export const ROAD_CIRCUITY_FACTOR = 1.3;
