import {
  transportFactor,
  repairAvoided,
  avoidedTripBaseline,
} from "../carbonTracking/emissionFactorService.js";
import { metresToKm, kmToMetres } from "../../utils/units.js";

/**
 * THE INTEGRATION LAYER.
 *
 * Maps a time-banking service category to a carbon domain + a calculator.
 * TimeBankingService never contains carbon maths - it only asks this registry
 * whether a category has a linked carbon impact. Adding a new linked category
 * means adding one entry here and nothing else changes.
 *
 * Categories absent from this map deliberately have no automatic carbon link
 * (in-person tutoring and general assistance have no inherent footprint).
 */

/** A shared ride: emissions split across riders, saving vs each driving alone. */
const calcRideShare = (txn) => {
  const distanceMetres = txn.tripData?.distanceMetres || 0;
  const participants = Math.max(2, txn.tripData?.participants || 2);
  const km = metresToKm(distanceMetres);

  const total = km * transportFactor("shared_ride");
  const perPerson = total / participants;
  const saved = Math.max(0, km * transportFactor("private_car") - perPerson);

  return {
    subtype: "shared_ride",
    emissionsGrams: Math.round(perPerson),
    savedGrams: Math.round(saved),
    verificationStatus: "verified",
    verificationNote: "Auto-generated from a mutually confirmed time-bank ride share",
    payload: { distanceMetres, participants, linked: true },
  };
};

/** A shared errand consolidates two trips into one - saves one whole trip. */
const calcSharedErrand = (txn) => {
  const baseline = avoidedTripBaseline();
  const distanceMetres =
    txn.tripData?.distanceMetres || kmToMetres(baseline.avoidedTripDefaultKm);
  const km = metresToKm(distanceMetres);

  const emissions = km * transportFactor("private_car");
  const saved = Math.round(km * transportFactor("private_car"));

  return {
    subtype: "shared_errand",
    emissionsGrams: Math.round(emissions / 2),
    savedGrams: saved,
    verificationStatus: "verified",
    verificationNote: "One trip served two people - second trip avoided",
    payload: { distanceMetres, linked: true },
  };
};

/** Repair extends product life, avoiding replacement manufacturing emissions. */
const calcRepairAvoided = () => ({
  subtype: "repair_avoided_replacement",
  emissionsGrams: 0,
  savedGrams: repairAvoided("home_repair"),
  verificationStatus: "verified",
  verificationNote: "Repair avoided the embodied emissions of a replacement item",
  payload: { linked: true },
});

/** Remote service replaces an in-person trip that would otherwise have happened. */
const calcAvoidedTrip = (txn) => {
  const baseline = avoidedTripBaseline();
  const distanceMetres =
    txn.tripData?.distanceMetres || kmToMetres(baseline.avoidedTripDefaultKm);
  const km = metresToKm(distanceMetres);
  const saved = Math.round(km * transportFactor(baseline.avoidedTripMode));

  return {
    subtype: "avoided_trip",
    emissionsGrams: 0,
    savedGrams: saved,
    verificationStatus: "verified",
    verificationNote: "Service delivered remotely - in-person trip avoided",
    payload: { distanceMetres, linked: true },
  };
};

const linkages = {
  ride_share: { domain: "transportation", calculate: calcRideShare, appliesTo: "both" },
  shared_errand: { domain: "transportation", calculate: calcSharedErrand, appliesTo: "both" },
  home_repair: { domain: "consumption", calculate: calcRepairAvoided, appliesTo: "receiver" },
  digital_help: { domain: "transportation", calculate: calcAvoidedTrip, appliesTo: "both" },
  tutoring_remote: { domain: "transportation", calculate: calcAvoidedTrip, appliesTo: "both" },
};

/** Returns the linkage config for a category, or null if it has no carbon link. */
export const getLinkage = (category) => linkages[category] || null;

export const hasLinkage = (category) => Boolean(linkages[category]);

export const linkedCategories = () => Object.keys(linkages);
