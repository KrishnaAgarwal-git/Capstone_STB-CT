import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { listingApi, transactionApi } from "../api";
import { useAuth } from "../context/AuthContext";
import AppShell from "./AppShell";

const LINKED = new Set(["ride_share", "shared_errand", "home_repair", "digital_help", "tutoring_remote"]);
const NEEDS_DISTANCE = new Set(["ride_share", "shared_errand"]);

const STATUS_LABEL = {
  REQUESTED: "Awaiting acceptance", ACCEPTED: "Accepted", EXECUTED: "Awaiting confirmation",
  COMPLETED: "Completed", DISPUTED: "Disputed", CANCELLED: "Cancelled",
};
const STATUS_CHIP = {
  REQUESTED: "amber", ACCEPTED: "cyan", EXECUTED: "cyan",
  COMPLETED: "green", DISPUTED: "red", CANCELLED: "red",
};

export default function Marketplace() {
  const { user, config, refreshUser } = useAuth();
  const [tab, setTab] = useState("browse");
  const [listings, setListings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const [form, setForm] = useState({ title: "", description: "", category: "", estimatedHours: 1 });
  const [requestFor, setRequestFor] = useState(null);
  const [requestData, setRequestData] = useState({ hours: 1, distanceKm: "", participants: 2 });
  const [disputeFor, setDisputeFor] = useState(null);
  const [disputeReason, setDisputeReason] = useState("");

  const categories = config.serviceCategories || [];

  const load = async () => {
    try {
      setLoading(true);
      const [l, t] = await Promise.all([listingApi.browse(), transactionApi.list()]);
      setListings(l);
      setTransactions(t);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const createListing = async (e) => {
    e.preventDefault();
    if (!form.title || !form.category) return toast.error("Give your service a title and a category.");
    try {
      setBusy("create");
      await listingApi.create(form);
      toast.success("Service posted to your circle.");
      setForm({ title: "", description: "", category: "", estimatedHours: 1 });
      setTab("browse");
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    try {
      setBusy("request");
      await transactionApi.request({
        listingId: requestFor._id, hours: Number(requestData.hours),
        distanceKm: requestData.distanceKm ? Number(requestData.distanceKm) : undefined,
        participants: Number(requestData.participants) || 2,
      });
      toast.success("Request sent — the provider needs to accept it.");
      setRequestFor(null);
      setRequestData({ hours: 1, distanceKm: "", participants: 2 });
      setTab("activity");
      load(); refreshUser();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const submitDispute = async (e) => {
    e.preventDefault();
    if (!disputeReason.trim()) return toast.error("Give a reason for the dispute.");
    try {
      setBusy(disputeFor._id);
      await transactionApi.dispute(disputeFor._id, disputeReason);
      toast.success("Transaction disputed — no credits were moved.");
      setDisputeFor(null); setDisputeReason("");
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const act = async (fn, id, successMsg) => {
    try {
      setBusy(id);
      const res = await fn(id);
      toast.success(res?.data?.message || successMsg);
      await load(); await refreshUser();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const isMine = (t, role) => String(t[role]?._id || t[role]) === String(user?.id);

  return (
    <AppShell wide>
      <div className="page-head">
        <div>
          <p className="page-eyebrow">Time Banking</p>
          <h1 className="page-title">Service Exchange</h1>
          <p className="page-sub">One hour equals {config.creditsPerHour} credits, whatever the skill.</p>
        </div>
      </div>

      <div className="tab-row">
        <button className={`tab ${tab === "browse" ? "is-active" : ""}`} onClick={() => setTab("browse")}>Browse</button>
        <button className={`tab ${tab === "post" ? "is-active" : ""}`} onClick={() => setTab("post")}>Post a service</button>
        <button className={`tab ${tab === "activity" ? "is-active" : ""}`} onClick={() => setTab("activity")}>
          My activity ({transactions.length})
        </button>
      </div>

      {loading && <div className="boot-state"><div className="boot-ring" /><p>Loading…</p></div>}

      {!loading && tab === "browse" && (
        listings.length === 0 ? (
          <div className="empty-state">
            <h3>No services offered yet</h3>
            <p>Nobody in your circle has posted a service. Be the first.</p>
            <button className="btn btn--primary" onClick={() => setTab("post")}>Post a service</button>
          </div>
        ) : (
          <div className="tile-grid">
            {listings.map((l) => (
              <article key={l._id} className="tile">
                <div className="tile-head">
                  <h3 className="tile-title">{l.title}</h3>
                  {LINKED.has(l.category) && (
                    <span className="chip chip--green" title="Completing this also creates a carbon record">linked</span>
                  )}
                </div>
                <p className="tile-desc">{l.description || "No description given."}</p>
                <div className="tile-meta">
                  <span>{l.provider?.firstName} {l.provider?.lastName}</span>
                  <span>{l.estimatedHours}h · {Math.round(l.estimatedHours * config.creditsPerHour)} cr</span>
                </div>
                <button className="btn btn--primary btn--full"
                  onClick={() => { setRequestFor(l); setRequestData((d) => ({ ...d, hours: l.estimatedHours })); }}>
                  Request this
                </button>
              </article>
            ))}
          </div>
        )
      )}

      {!loading && tab === "post" && (
        <form className="panel" onSubmit={createListing} style={{ maxWidth: 560 }}>
          <label className="field-label">Title</label>
          <input className="field" value={form.title} placeholder="e.g. Python tutoring"
            onChange={(e) => setForm({ ...form, title: e.target.value })} />

          <label className="field-label">Category</label>
          <select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}{c.linked ? " — carbon linked" : ""}</option>
            ))}
          </select>
          {form.category && LINKED.has(form.category) && (
            <p className="field-hint field-hint--accent">
              Completing this service will automatically create a carbon record for the receiver.
            </p>
          )}

          <label className="field-label">Description</label>
          <textarea className="field" rows="3" value={form.description}
            placeholder="What exactly are you offering?"
            onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <label className="field-label">Typical duration (hours)</label>
          <input className="field" type="number" min="0.25" max="8" step="0.25" value={form.estimatedHours}
            onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} />
          <p className="field-hint">Worth {Math.round((Number(form.estimatedHours) || 0) * config.creditsPerHour)} credits.</p>

          <button className="btn btn--primary" style={{ marginTop: 20 }} disabled={busy === "create"}>
            {busy === "create" ? "Posting…" : "Post service"}
          </button>
        </form>
      )}

      {!loading && tab === "activity" && (
        transactions.length === 0 ? (
          <div className="empty-state">
            <h3>No exchanges yet</h3>
            <p>Request a service from your circle to get started.</p>
            <button className="btn btn--primary" onClick={() => setTab("browse")}>Browse services</button>
          </div>
        ) : (
          <div className="row-list">
            {transactions.map((t) => {
              const provider = isMine(t, "provider");
              const other = provider ? t.receiver : t.provider;
              const canAct = !["COMPLETED", "CANCELLED", "DISPUTED"].includes(t.status);
              return (
                <article key={t._id} className="row">
                  <div className="row-main">
                    <p className="row-title">
                      {t.listing?.title || t.category}
                      <span className={`chip chip--${STATUS_CHIP[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                    </p>
                    <p className="row-meta">
                      {provider ? "You are providing for" : "Provided by"} {other?.firstName} {other?.lastName}
                      {" · "}{t.hours}h · {t.credits} credits
                    </p>
                    {t.linkedCarbonActivity && (
                      <p className="row-note">A carbon record was created automatically from this exchange.</p>
                    )}
                  </div>

                  <div className="row-actions">
                    {t.status === "REQUESTED" && provider && (
                      <button className="btn btn--primary btn--sm" disabled={busy === t._id}
                        onClick={() => act(transactionApi.accept, t._id, "Request accepted")}>Accept</button>
                    )}
                    {t.status === "ACCEPTED" && provider && (
                      <button className="btn btn--primary btn--sm" disabled={busy === t._id}
                        onClick={() => act(transactionApi.execute, t._id, "Marked as delivered")}>Mark delivered</button>
                    )}
                    {["ACCEPTED", "EXECUTED"].includes(t.status) && (
                      <button className="btn btn--primary btn--sm" disabled={busy === t._id}
                        onClick={() => act((id) => transactionApi.confirm(id), t._id, "Confirmed")}>Confirm</button>
                    )}
                    {canAct && (
                      <button className="btn btn--danger btn--sm" disabled={busy === t._id}
                        onClick={() => setDisputeFor(t)}>Dispute</button>
                    )}
                    {canAct && (
                      <button className="btn btn--ghost btn--sm" disabled={busy === t._id}
                        onClick={() => act(transactionApi.cancel, t._id, "Cancelled")}>Cancel</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}

      {requestFor && (
        <div className="modal-backdrop" onClick={() => setRequestFor(null)}>
          <form className="modal-panel" onClick={(e) => e.stopPropagation()} onSubmit={submitRequest}>
            <h3>Request: {requestFor.title}</h3>
            <p style={{ color: "var(--text-2)", fontSize: "0.85rem" }}>
              from {requestFor.provider?.firstName} {requestFor.provider?.lastName}
            </p>

            <label className="field-label">Hours</label>
            <input className="field" type="number" min="0.25" step="0.25" value={requestData.hours}
              onChange={(e) => setRequestData({ ...requestData, hours: e.target.value })} />
            <p className="field-hint">
              Costs {Math.round((Number(requestData.hours) || 0) * config.creditsPerHour)} credits. You have {user?.credits ?? 0}.
            </p>

            {NEEDS_DISTANCE.has(requestFor.category) && (
              <>
                <label className="field-label">Trip distance (km)</label>
                <input className="field" type="number" min="0" step="0.5" value={requestData.distanceKm}
                  placeholder="e.g. 12" onChange={(e) => setRequestData({ ...requestData, distanceKm: e.target.value })} />
                <label className="field-label">People sharing the trip</label>
                <input className="field" type="number" min="2" max="6" value={requestData.participants}
                  onChange={(e) => setRequestData({ ...requestData, participants: e.target.value })} />
                <p className="field-hint field-hint--accent">Emissions are split equally between everyone sharing the trip.</p>
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setRequestFor(null)}>Cancel</button>
              <button className="btn btn--primary" disabled={busy === "request"}>
                {busy === "request" ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        </div>
      )}

      {disputeFor && (
        <div className="modal-backdrop" onClick={() => setDisputeFor(null)}>
          <form className="modal-panel" onClick={(e) => e.stopPropagation()} onSubmit={submitDispute}>
            <h3>Dispute: {disputeFor.listing?.title || disputeFor.category}</h3>
            <p style={{ color: "var(--text-2)", fontSize: "0.85rem", marginBottom: 10 }}>
              No credits will move while this is disputed.
            </p>
            <label className="field-label">Reason</label>
            <textarea className="field" rows="3" value={disputeReason}
              placeholder="What went wrong?" onChange={(e) => setDisputeReason(e.target.value)} />
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setDisputeFor(null)}>Cancel</button>
              <button className="btn btn--danger" disabled={busy === disputeFor._id}>
                {busy === disputeFor._id ? "Submitting…" : "Submit dispute"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
