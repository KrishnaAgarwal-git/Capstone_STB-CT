import {
  transportFactor,
  gridFactor,
  isKnownRegion,
  evEnergyWhPerKm,
} from "./emissionFactorService.js";
import { metresToKm } from "../../utils/units.js";
import { badRequest } from "../../utils/ApiError.js";

const MAX_PLAUSIBLE_SPEED_KMH = {
  petrol_car: 140,
  diesel_car: 140,
  cng_car: 130,
  two_wheeler: 110,
  auto_rickshaw: 70,
  public_transit: 90,
  rail_metro: 160,
  shared_ride: 140,
  electric_vehicle: 140,
  walk_cycle: 30,
};

/**
 * Baseline for "savings" is always a solo petrol-car trip of the same
 * distance (DEFRA 2024 average petrol car - see SCIENTIFIC_BASIS.md §2).
 * Savings can never be negative - a car trip saves nothing, it just emits.
 */
const soloCarEmissions = (km) => km * transportFactor("petrol_car");

/** Straightforward factor x distance - used by every mode with a fixed published/derived factor. */
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
 * Public transit (bus or rail/metro): verified with GPS + timestamps.
 * We reject implausible speeds rather than trusting the client blindly.
 */
const calcVerifiedTransit = (transportKey) => ({ distanceMetres, startTime, endTime }) => {
  const km = metresToKm(distanceMetres);
  const emissions = km * transportFactor(transportKey);
  const saved = Math.max(0, soloCarEmissions(km) - emissions);

  let verificationStatus = "unverified";
  let verificationNote;

  if (startTime && endTime) {
    const hours = (new Date(endTime) - new Date(startTime)) / 3600000;
    if (hours <= 0) throw badRequest("Trip end time must be after start time");
    const speed = km / hours;
    if (speed > MAX_PLAUSIBLE_SPEED_KMH[transportKey]) {
      verificationStatus = "flagged";
      verificationNote = `Implied speed ${speed.toFixed(0)} km/h exceeds plausible ${transportKey.replace("_", " ")} speed`;
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

export const calcPublicTransit = calcVerifiedTransit("public_transit");
export const calcRailMetro = calcVerifiedTransit("rail_metro");

/**
 * Shared ride: emissions split equally across participants.
 * Savings are per-person versus each having driven alone.
 * QR/code confirmation is checked by the caller before this is invoked.
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
      ? "Verification code matched between participants"
      : "Awaiting verification code from co-rider",
  };
};

/**
 * EV: never zero. Emissions come from the regional grid mix (CEA India WAEF
 * by default - see SCIENTIFIC_BASIS.md §2). Missing region falls back to the
 * national average and is flagged, never zeroed.
 */
export const calcElectricVehicle = ({ distanceMetres, region }) => {
  const km = metresToKm(distanceMetres);
  const whPerKm = evEnergyWhPerKm();
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
      : `Grid mix for ${region}: ${factor} gCO2e/kWh (CEA WAEF)`,
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
  petrol_car: calcStandard,
  diesel_car: calcStandard,
  cng_car: calcStandard,
  two_wheeler: calcStandard,
  auto_rickshaw: calcStandard,
  public_transit: calcPublicTransit,
  rail_metro: calcRailMetro,
  shared_ride: calcSharedRide,
  electric_vehicle: calcElectricVehicle,
  walk_cycle: calcWalkCycle,
};

export const speedSanityCheck = (mode, km, hours) => {
  if (!hours || hours <= 0) return true;
  const limit = MAX_PLAUSIBLE_SPEED_KMH[mode] ?? 140;
  return km / hours <= limit;
};
