import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { carbonApi, insightsApi } from "../api";
import { useAuth } from "../context/AuthContext";
import AppShell from "./AppShell";
import { captureLocation, haversineKm } from "../utils/geo";
import { spotlightMove } from "../utils/spotlight";

// Client-side preview factors (grams CO2e per passenger-km) — mirror
// Backend/src/data/scientificEmissionFactors.js for an instant readout.
// The authoritative figure is always computed server-side on submit.
const PREVIEW_FACTORS = {
  petrol_car: 170, diesel_car: 168, cng_car: 134, two_wheeler: 51,
  auto_rickshaw: 64, public_transit: 96, rail_metro: 35.46,
  shared_ride: 170, electric_vehicle: 107, walk_cycle: 0,
};
const PREVIEW_GRID_FACTOR = 700; // g CO2e/kWh, national average
const PREVIEW_FOOD = { vegan: 450, vegetarian: 700, dairy: 1300, fish: 1600, poultry: 1800, red_meat: 6900 };
const PREVIEW_CONSUMPTION = { clothing_item: 8500, electronics_small: 34000, electronics_large: 120000, household_goods: 5200, packaging_waste: 400 };

const DOMAINS = [
  { key: "transportation", label: "Transport", icon: "🚌" },
  { key: "electricity", label: "Electricity", icon: "⚡" },
  { key: "food", label: "Food", icon: "🍽️" },
  { key: "consumption", label: "Consumption", icon: "📦" },
];

const CITATIONS = {
  petrol_car: "DEFRA 2024 (UK Govt GHG Conversion Factors)", diesel_car: "DEFRA 2024",
  cng_car: "Derived: IPCC 2006 CNG factor ÷ India fuel economy",
  two_wheeler: "Derived: IPCC 2006 petrol factor ÷ India fuel economy",
  auto_rickshaw: "Derived: IPCC 2006 CNG factor ÷ India fuel economy",
  public_transit: "DEFRA 2024 (avg. local bus)", rail_metro: "DEFRA 2024 (National Rail)",
  shared_ride: "DEFRA 2024, split across riders", electric_vehicle: "CEA India Grid WAEF (v21.0, FY24-25)",
  walk_cycle: "Zero direct emissions",
  electricity: "CEA India Grid WAEF (v21.0, FY24-25)",
  food: "Poore & Nemecek (2018), Science 360(6392)",
  consumption: "Indicative — published LCA-aggregate midpoint",
};

const FOOD_TYPES = [
  { key: "vegan", label: "Vegan meal" }, { key: "vegetarian", label: "Vegetarian meal" },
  { key: "dairy", label: "Dairy-heavy meal" }, { key: "fish", label: "Fish" },
  { key: "poultry", label: "Poultry" }, { key: "red_meat", label: "Red meat" },
];
const CONSUMPTION_TYPES = [
  { key: "clothing_item", label: "Clothing item" }, { key: "electronics_small", label: "Small electronics" },
  { key: "electronics_large", label: "Large electronics" }, { key: "household_goods", label: "Household goods" },
  { key: "packaging_waste", label: "Packaging waste" },
];

export default function CarbonCalculator() {
  const { config, refreshUser } = useAuth();
  const [domain, setDomain] = useState("transportation");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  const [transport, setTransport] = useState({ subtype: "public_transit", distanceKm: "", startTime: "", endTime: "", participants: 2 });
  const [electricity, setElectricity] = useState({ kwh: "" });
  const [food, setFood] = useState({ subtype: "vegetarian", servings: 1 });
  const [consumption, setConsumption] = useState({ subtype: "household_goods", quantity: 1 });

  const [gpsStart, setGpsStart] = useState(null);
  const [gpsEnd, setGpsEnd] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);

  const [rideMode, setRideMode] = useState("generate");
  const [rideCode, setRideCode] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [rideBusy, setRideBusy] = useState(false);

  const [recommendations, setRecommendations] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);

  const loadHistory = async () => {
    try { setHistory(await carbonApi.history({ limit: 12 })); }
    catch (err) { toast.error(err.message); }
  };
  useEffect(() => { loadHistory(); }, []);

  const loadRecommendations = async () => {
    try {
      setRecsLoading(true);
      const res = await insightsApi.get();
      setRecommendations(res);
    } catch (err) {
      // Non-fatal - the calculator still works without recommendations
      setRecommendations({ source: "error", insights: [] });
    } finally {
      setRecsLoading(false);
    }
  };
  useEffect(() => { loadRecommendations(); }, []);

  /* ---- Live preview estimate ---- */
  const preview = useMemo(() => {
    if (domain === "transportation" && transport.subtype !== "shared_ride") {
      const km = Number(transport.distanceKm) || 0;
      const factor = PREVIEW_FACTORS[transport.subtype] ?? 171;
      const emitted = km * factor;
      const saved = Math.max(0, km * PREVIEW_FACTORS.petrol_car - emitted);
      return { emitted, saved };
    }
    if (domain === "electricity") {
      const kwh = Number(electricity.kwh) || 0;
      return { emitted: kwh * PREVIEW_GRID_FACTOR, saved: 0 };
    }
    if (domain === "food") {
      const servings = Number(food.servings) || 0;
      return { emitted: (PREVIEW_FOOD[food.subtype] || 0) * servings, saved: 0 };
    }
    if (domain === "consumption") {
      const qty = Number(consumption.quantity) || 0;
      return { emitted: (PREVIEW_CONSUMPTION[consumption.subtype] || 0) * qty, saved: 0 };
    }
    return { emitted: 0, saved: 0 };
  }, [domain, transport, electricity, food, consumption]);

  const captureStart = async () => {
    setGpsBusy(true);
    try {
      const point = await captureLocation();
      setGpsStart(point);
      toast.success("Start location captured");
    } catch (err) { toast.error(err.message); }
    finally { setGpsBusy(false); }
  };

  const captureEnd = async () => {
    setGpsBusy(true);
    try {
      const point = await captureLocation();
      setGpsEnd(point);
      if (gpsStart) {
        const km = haversineKm(gpsStart, point);
        setTransport((t) => ({ ...t, distanceKm: km.toFixed(2) }));
        toast.success(`End captured — ${km.toFixed(2)} km trip`);
      }
    } catch (err) { toast.error(err.message); }
    finally { setGpsBusy(false); }
  };

  const resetGps = () => { setGpsStart(null); setGpsEnd(null); };

  const submit = async (e) => {
    e.preventDefault();
    let payload;

    if (domain === "transportation") {
      if (!transport.distanceKm) return toast.error("Enter the trip distance.");
      payload = {
        domain, subtype: transport.subtype, distanceKm: Number(transport.distanceKm),
        participants: Number(transport.participants) || 2,
        startTime: transport.startTime || undefined, endTime: transport.endTime || undefined,
      };
    } else if (domain === "electricity") {
      if (!electricity.kwh) return toast.error("Enter kilowatt-hours used.");
      payload = { domain, subtype: "grid_electricity", kwh: Number(electricity.kwh) };
    } else if (domain === "food") {
      payload = { domain, subtype: food.subtype, servings: Number(food.servings) || 1 };
    } else {
      payload = { domain, subtype: consumption.subtype, quantity: Number(consumption.quantity) || 1 };
    }

    try {
      setBusy(true);
      const activity = await carbonApi.log(payload);
      const kg = (activity.emissionsGrams / 1000).toFixed(2);
      const saved = (activity.savedGrams / 1000).toFixed(2);
      toast.success(activity.savedGrams > 0
        ? `Logged: ${kg} kg emitted, ${saved} kg saved versus driving.`
        : `Logged: ${kg} kg CO₂e.`);
      if (activity.verificationStatus === "flagged") {
        toast(activity.verificationNote || "Flagged for review.", { icon: "⚠️" });
      }
      setTransport((t) => ({ ...t, distanceKm: "", startTime: "", endTime: "" }));
      setElectricity({ kwh: "" });
      resetGps();
      loadHistory();
      refreshUser();
      loadRecommendations();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const generateRideCode = async (e) => {
    e.preventDefault();
    if (!transport.distanceKm) return toast.error("Enter the trip distance first.");
    try {
      setRideBusy(true);
      const res = await carbonApi.generateRideCode({
        distanceKm: Number(transport.distanceKm), participants: Number(transport.participants) || 2,
      });
      setRideCode(res.code);
      toast.success("Code generated — share it with your rider");
    } catch (err) { toast.error(err.message); }
    finally { setRideBusy(false); }
  };

  const verifyRideCode = async (e) => {
    e.preventDefault();
    if (!joinCode) return toast.error("Enter your driver's code.");
    try {
      setRideBusy(true);
      const activity = await carbonApi.verifyRideCode(joinCode.toUpperCase());
      toast.success(`Verified — ${(activity.emissionsGrams / 1000).toFixed(2)} kg logged, ${(activity.savedGrams / 1000).toFixed(2)} kg saved`);
      setJoinCode("");
      loadHistory();
      refreshUser();
      loadRecommendations();
    } catch (err) { toast.error(err.message); }
    finally { setRideBusy(false); }
  };

  const reverse = async (id) => {
    try {
      await carbonApi.reverse(id, "user_edit");
      toast.success("Reversed — a compensating record was written and points adjusted.");
      loadHistory();
      refreshUser();
      loadRecommendations();
    } catch (err) { toast.error(err.message); }
  };

  const isSharedRide = domain === "transportation" && transport.subtype === "shared_ride";

  return (
    <AppShell wide>
      <div className="page-head">
        <div>
          <p className="page-eyebrow">Carbon Tracking</p>
          <h1 className="page-title">Carbon Calculator</h1>
          <p className="page-sub">
            Live-updating estimate as you type. Emission factors follow the GHG Protocol standard.
          </p>
        </div>
      </div>

      <div className="tab-row">
        {DOMAINS.map((d) => (
          <button key={d.key} className={`tab ${domain === d.key ? "is-active" : ""}`}
            onClick={() => setDomain(d.key)}>
            {d.icon} {d.label}
          </button>
        ))}
      </div>

      <div className="calc-layout">
        <form className="panel spotlight" onMouseMove={spotlightMove} onSubmit={isSharedRide ? undefined : submit}>
          {domain === "transportation" && (
            <>
              <label className="field-label">Mode of transport</label>
              <div className="calc-mode-grid">
                {(config.transportModes || []).map((m) => (
                  <button key={m.key} type="button"
                    className={`calc-mode-btn ${transport.subtype === m.key ? "is-active" : ""}`}
                    onClick={() => { setTransport({ ...transport, subtype: m.key }); resetGps(); }}>
                    <span className="calc-mode-icon">
                      {{ petrol_car: "🚗", diesel_car: "🚙", cng_car: "🚕", two_wheeler: "🛵",
                         auto_rickshaw: "🛺", public_transit: "🚌", rail_metro: "🚆",
                         shared_ride: "🚐", electric_vehicle: "🔋", walk_cycle: "🚶" }[m.key] || "🚗"}
                    </span>
                    {m.label}
                  </button>
                ))}
              </div>

              {!isSharedRide && (
                <>
                  <label className="field-label">Distance (km)</label>
                  <input className="field" type="number" min="0.1" step="0.1" value={transport.distanceKm}
                    placeholder="e.g. 12" onChange={(e) => setTransport({ ...transport, distanceKm: e.target.value })} />

                  <div className="gps-row">
                    <button type="button" className="btn btn--ghost btn--sm" disabled={gpsBusy} onClick={captureStart}>
                      {gpsStart ? "✓ Start captured" : "📍 Capture start (GPS)"}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={gpsBusy || !gpsStart} onClick={captureEnd}>
                      {gpsEnd ? "✓ End captured" : "📍 Capture end (GPS)"}
                    </button>
                  </div>
                  <p className="field-hint">Uses your device's real GPS via the browser.</p>
                </>
              )}

              {(transport.subtype === "public_transit" || transport.subtype === "rail_metro") && (
                <>
                  <label className="field-label">Trip start (optional)</label>
                  <input className="field" type="datetime-local" value={transport.startTime}
                    onChange={(e) => setTransport({ ...transport, startTime: e.target.value })} />
                  <label className="field-label">Trip end (optional)</label>
                  <input className="field" type="datetime-local" value={transport.endTime}
                    onChange={(e) => setTransport({ ...transport, endTime: e.target.value })} />
                  <p className="field-hint">Adding times lets the system verify against a plausible transit speed.</p>
                </>
              )}

              {transport.subtype === "electric_vehicle" && (
                <p className="field-hint field-hint--accent">
                  EV emissions use your region's electricity grid mix, not treated as zero.
                </p>
              )}

              {isSharedRide && (
                <div style={{ marginTop: 20 }}>
                  <p className="field-hint field-hint--accent" style={{ marginBottom: 16 }}>
                    Shared rides are verified with a one-time code instead of a plain form — this proves
                    both riders were together. (A production build would render this as a scannable QR
                    image; functionally identical, since a QR code just encodes this string.)
                  </p>

                  <div className="tab-row" style={{ marginBottom: 16 }}>
                    <button type="button" className={`tab ${rideMode === "generate" ? "is-active" : ""}`}
                      onClick={() => setRideMode("generate")}>I'm driving</button>
                    <button type="button" className={`tab ${rideMode === "join" ? "is-active" : ""}`}
                      onClick={() => setRideMode("join")}>I'm riding along</button>
                  </div>

                  {rideMode === "generate" ? (
                    <div>
                      <label className="field-label">Trip distance (km)</label>
                      <input className="field" type="number" min="0.1" step="0.1" value={transport.distanceKm}
                        placeholder="e.g. 8" onChange={(e) => setTransport({ ...transport, distanceKm: e.target.value })} />
                      <div className="gps-row">
                        <button type="button" className="btn btn--ghost btn--sm" disabled={gpsBusy} onClick={captureStart}>
                          {gpsStart ? "✓ Start" : "📍 Start (GPS)"}
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" disabled={gpsBusy || !gpsStart} onClick={captureEnd}>
                          {gpsEnd ? "✓ End" : "📍 End (GPS)"}
                        </button>
                      </div>
                      <label className="field-label">Riders including you</label>
                      <input className="field" type="number" min="2" max="6" value={transport.participants}
                        onChange={(e) => setTransport({ ...transport, participants: e.target.value })} />
                      <button type="button" className="btn btn--primary" style={{ marginTop: 16 }}
                        disabled={rideBusy} onClick={generateRideCode}>
                        {rideBusy ? "Generating…" : "Generate code"}
                      </button>
                      {rideCode && (
                        <div className="code-display">
                          <p style={{ color: "var(--text-2)", fontSize: "0.8rem" }}>Show this to your rider — expires in 15 minutes</p>
                          <div className="code-value">{rideCode}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="field-label">Enter your driver's code</label>
                      <input className="field code-input" value={joinCode} placeholder="XJ4K9P" maxLength={6}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
                      <button type="button" className="btn btn--primary" style={{ marginTop: 16 }}
                        disabled={rideBusy} onClick={verifyRideCode}>
                        {rideBusy ? "Verifying…" : "Verify and log"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {domain === "electricity" && (
            <>
              <label className="field-label">Electricity used (kWh)</label>
              <input className="field" type="number" min="0.1" step="0.1" value={electricity.kwh}
                placeholder="e.g. 4.5" onChange={(e) => setElectricity({ kwh: e.target.value })} />
              <p className="field-hint">Check your meter or a recent bill for a daily figure.</p>
            </>
          )}

          {domain === "food" && (
            <>
              <label className="field-label">Meal type</label>
              <select className="field" value={food.subtype} onChange={(e) => setFood({ ...food, subtype: e.target.value })}>
                {FOOD_TYPES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <label className="field-label">Servings</label>
              <input className="field" type="number" min="1" max="20" value={food.servings}
                onChange={(e) => setFood({ ...food, servings: e.target.value })} />
            </>
          )}

          {domain === "consumption" && (
            <>
              <label className="field-label">Item type</label>
              <select className="field" value={consumption.subtype} onChange={(e) => setConsumption({ ...consumption, subtype: e.target.value })}>
                {CONSUMPTION_TYPES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <label className="field-label">Quantity</label>
              <input className="field" type="number" min="1" max="50" value={consumption.quantity}
                onChange={(e) => setConsumption({ ...consumption, quantity: e.target.value })} />
            </>
          )}

          {!isSharedRide && (
            <button className="btn btn--primary btn--full" style={{ marginTop: 22 }} disabled={busy}>
              {busy ? "Saving…" : "Log activity"}
            </button>
          )}
        </form>

        <div className="panel calc-readout spotlight" onMouseMove={spotlightMove}>
          <p className="calc-readout-label">Live Estimate</p>
          <div>
            <span className="calc-readout-number">{(preview.emitted / 1000).toFixed(2)}</span>
            <span className="calc-readout-unit">KG CO₂e</span>
          </div>
          {preview.saved > 0 && (
            <div className="calc-readout-saved">
              versus driving alone
              <strong>{(preview.saved / 1000).toFixed(2)} kg saved</strong>
            </div>
          )}
          <div className="chip chip--green" style={{ marginTop: 18, display: "inline-block" }}>
            {domain === "transportation" ? (CITATIONS[transport.subtype] || CITATIONS.petrol_car) : CITATIONS[domain]}
          </div>
          <p className="field-hint" style={{ marginTop: 12 }}>
            Preview only — the exact figure is calculated when you log it, using the same
            cited standard, plus any GPS/verification checks. Full methodology in
            SCIENTIFIC_BASIS.md.
          </p>
        </div>
      </div>

      <div className="section-label"><span>Recommended For You</span></div>

      <div className="panel spotlight" style={{ marginBottom: 8 }} onMouseMove={spotlightMove}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-2)" }}>
              {recommendations?.source === "linucb_engine"
                ? "Powered by the LinUCB contextual-bandit recommendation engine"
                : recommendations?.source === "rule_based_fallback"
                ? "Rule-based recommendations (AI engine offline — showing fallback)"
                : "Personalized suggestions based on your logged activity"}
            </p>
          </div>
          <Link to="/insights" className="btn btn--primary btn--sm">Open Full AI Insights →</Link>
        </div>

        {recsLoading ? (
          <div className="row-list">
            <div className="skel-row"><div className="skel-avatar" /><div className="skel-row-lines"><div className="skel-line skel-line--title" /><div className="skel-line skel-line--meta" /></div></div>
          </div>
        ) : !recommendations?.insights?.length ? (
          <p className="field-hint">Log a few activities above and personalized recommendations will appear here.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {recommendations.insights.slice(0, 2).map((ins, i) => (
              <article key={i} className="insight-card spotlight" onMouseMove={spotlightMove}>
                <div className="insight-icon">{ins.icon}</div>
                <div style={{ flex: 1 }}>
                  <h3 className="insight-title">{ins.title}</h3>
                  <p className="insight-body">{ins.body}</p>
                  {ins.stat && <p className="insight-stat" style={{ marginTop: 6 }}>{ins.stat}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="section-label"><span>Recent Activity</span></div>

      {history.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📋</div><h3>Nothing logged yet</h3><p>Your history will appear here.</p></div>
      ) : (
        <div className="row-list">
          {history.map((a) => (
            <article key={a._id} className="row">
              <div className="row-main">
                <p className="row-title">
                  {a.subtype.replace(/_/g, " ")}
                  {a.source === "time_bank_linked" && <span className="chip chip--green">from time bank</span>}
                  {a.verificationStatus === "verified" && <span className="chip chip--green">verified</span>}
                  {a.verificationStatus === "flagged" && <span className="chip chip--amber">flagged</span>}
                </p>
                <p className="row-meta">
                  {(a.emissionsGrams / 1000).toFixed(2)} kg emitted
                  {a.savedGrams > 0 && ` · ${(a.savedGrams / 1000).toFixed(2)} kg saved`}
                  {" · "}{new Date(a.occurredAt).toLocaleDateString()}
                </p>
                {a.verificationNote && <p className="row-note">{a.verificationNote}</p>}
              </div>
              {a.source === "manual" && !a.reversedBy && (
                <div className="row-actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => reverse(a._id)}>Undo</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
