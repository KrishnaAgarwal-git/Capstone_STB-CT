import {
  transportFactor,
  gridFactor,
  isKnownRegion,
  getFactors,
} from "./emissionFactorService.js";
import { metresToKm } from "../../utils/units.js";
import { badRequest } from "../../utils/ApiError.js";

const MAX_PLAUSIBLE_SPEED_KMH = {
  private_car: 140,
  two_wheeler: 110,
  auto_rickshaw: 70,
  public_transit: 100,
  shared_ride: 140,
  electric_vehicle: 140,
  walk_cycle: 30,
};

/**
 * Baseline for "savings" is always a solo private-car trip of the same distance.
 * Savings can never be negative - a car trip saves nothing, it just emits.
 */
const soloCarEmissions = (km) => km * transportFactor("private_car");

/** Private car, two-wheeler, auto-rickshaw: straightforward factor x distance. */
export const calcStandard = ({ mode, distanceMetres }) => {
  const km = metresToKm(distanceMetres);
  const emissions = km * transportFactor(mode);
  const saved = Math.max(0, soloCarEmissions(km) - emissions);
  return {
    emissionsGrams: Math.round(emissions),
    savedGrams: Math.round(saved),
    verificationStatus: "unverified",
  };
};

/**
 * Public transit: verified with GPS + timestamps.
 * We reject implausible speeds rather than trusting the client blindly.
 */
export const calcPublicTransit = ({ distanceMetres, startTime, endTime }) => {
  const km = metresToKm(distanceMetres);
  const emissions = km * transportFactor("public_transit");
  const saved = Math.max(0, soloCarEmissions(km) - emissions);

  let verificationStatus = "unverified";
  let verificationNote;

  if (startTime && endTime) {
    const hours = (new Date(endTime) - new Date(startTime)) / 3600000;
    if (hours <= 0) throw badRequest("Trip end time must be after start time");
    const speed = km / hours;
    if (speed > MAX_PLAUSIBLE_SPEED_KMH.public_transit) {
      verificationStatus = "flagged";
      verificationNote = `Implied speed ${speed.toFixed(0)} km/h exceeds plausible transit speed`;
    } else {
      verificationStatus = "verified";
      verificationNote = `GPS + timestamp check passed (${speed.toFixed(0)} km/h)`;
    }
  }

  return {
    emissionsGrams: Math.round(emissions),
    savedGrams: Math.round(saved),
    verificationStatus,
    verificationNote,
  };
};

/**
 * Shared ride: emissions split equally across participants.
 * Savings are per-person versus each having driven alone.
 * QR confirmation is checked by the caller before this is invoked.
 */
export const calcSharedRide = ({ distanceMetres, participants = 2, qrVerified = false }) => {
  if (participants < 2) throw badRequest("A shared ride needs at least 2 participants");
  const km = metresToKm(distanceMetres);

  const totalEmissions = km * transportFactor("shared_ride");
  const perPerson = totalEmissions / participants;
  const saved = Math.max(0, soloCarEmissions(km) - perPerson);

  return {
    emissionsGrams: Math.round(perPerson),
    savedGrams: Math.round(saved),
    verificationStatus: qrVerified ? "verified" : "unverified",
    verificationNote: qrVerified
      ? "QR confirmation matched between participants"
      : "Awaiting QR confirmation from co-rider",
  };
};

/**
 * EV: never zero. Emissions come from the regional grid mix.
 * Missing region falls back to national average and is flagged, never zeroed.
 */
export const calcElectricVehicle = ({ distanceMetres, region }) => {
  const km = metresToKm(distanceMetres);
  const whPerKm = getFactors().evEnergyWhPerKm;
  const kWh = (km * whPerKm) / 1000;

  const assumedRegion = !region || !isKnownRegion(region);
  const factor = gridFactor(region);
  const emissions = kWh * factor;
  const saved = Math.max(0, soloCarEmissions(km) - emissions);

  return {
    emissionsGrams: Math.round(emissions),
    savedGrams: Math.round(saved),
    verificationStatus: assumedRegion ? "flagged" : "verified",
    verificationNote: assumedRegion
      ? "No valid region set - national average grid mix applied (estimate)"
      : `Grid mix for ${region}: ${factor} gCO2e/kWh`,
  };
};

export const calcWalkCycle = ({ distanceMetres }) => {
  const km = metresToKm(distanceMetres);
  return {
    emissionsGrams: 0,
    savedGrams: Math.round(soloCarEmissions(km)),
    verificationStatus: "unverified",
  };
};

export const transportCalculators = {
  private_car: calcStandard,
  two_wheeler: calcStandard,
  auto_rickshaw: calcStandard,
  public_transit: calcPublicTransit,
  shared_ride: calcSharedRide,
  electric_vehicle: calcElectricVehicle,
  walk_cycle: calcWalkCycle,
};

export const speedSanityCheck = (mode, km, hours) => {
  if (!hours || hours <= 0) return true;
  const limit = MAX_PLAUSIBLE_SPEED_KMH[mode] ?? 140;
  return km / hours <= limit;
};
