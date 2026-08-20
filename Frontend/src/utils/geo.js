/**
 * Wraps the browser's real Geolocation API. This is genuine GPS, not
 * simulated - it will ask for location permission and return the device's
 * actual coordinates. Distance between two captured points is computed
 * server-side (haversine + road circuity factor) in carbon.controller.js.
 */
export const captureLocation = () =>
  new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser does not support GPS location"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Could not get your location")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

export const haversineKm = (a, b) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
};
