import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { gamificationApi } from "../api";
import { useAuth } from "../context/AuthContext";
import AppShell from "./AppShell";

const BOARDS = [
  { key: "points", label: "Points", blurb: "Total points from services and carbon logging." },
  { key: "absolute", label: "Lowest footprint", blurb: "Smallest total emissions across all domains." },
  { key: "improvement", label: "Most improved", blurb: "Biggest reduction against your own 30-day baseline." },
  { key: "consistency", label: "Most consistent", blurb: "Days active out of the last 30." },
];

export default function Leaderboard() {
  const { user } = useAuth();
  const [board, setBoard] = useState("points");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");

  const load = async () => {
    try { setLoading(true); setData(await gamificationApi.leaderboards()); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const join = async (e) => {
    e.preventDefault();
    try {
      await gamificationApi.joinGroup(joinCode);
      toast.success("Joined the group.");
      setJoinCode("");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const rows = data?.[board] || [];

  const renderValue = (r) => {
    if (board === "points") return `${r.points} pts`;
    if (board === "absolute") return r.noData ? "no data" : `${r.emissionsKg} kg`;
    if (board === "improvement") return r.insufficientData ? "not enough history" : `${r.percentChange > 0 ? "−" : "+"}${Math.abs(r.percentChange)}%`;
    return `${r.activeDays}/${r.outOf} days`;
  };

  return (
    <AppShell wide>
      <div className="page-head">
        <div>
          <p className="page-eyebrow">Your Friend Circle</p>
          <h1 className="page-title">Leaderboards</h1>
          <p className="page-sub">Four separate boards, so nobody is locked out by where they started.</p>
        </div>
      </div>

      {loading && <div className="boot-state"><div className="boot-ring" /><p>Loading…</p></div>}

      {!loading && data?.status === "FORMING" && (
        <div className="empty-state">
          <h3>Leaderboards unlock at 5 members</h3>
          <p>{data.message} A ranking between two people isn't meaningful.</p>
          <form onSubmit={join} style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <input className="field" style={{ maxWidth: 220 }} placeholder="Invite code, e.g. DEMO01"
              value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
            <button className="btn btn--primary">Join group</button>
          </form>
        </div>
      )}

      {!loading && data?.status === "ACTIVE" && (
        <>
          <div className="tab-row">
            {BOARDS.map((b) => (
              <button key={b.key} className={`tab ${board === b.key ? "is-active" : ""}`} onClick={() => setBoard(b.key)}>
                {b.label}
              </button>
            ))}
          </div>
          <p className="field-hint" style={{ margin: "12px 0 20px" }}>{BOARDS.find((b) => b.key === board)?.blurb}</p>

          <div className="row-list">
            {rows.map((r) => {
              const isMe = String(r.userId) === String(user?.id);
              return (
                <article key={`${board}-${r.userId}`} className={`row ${isMe ? "row--me" : ""}`}>
                  <div className="row-rank">{r.rank}</div>
                  <div className="row-main">
                    <p className="row-title">
                      {r.name}{isMe && <span className="chip chip--green">you</span>}
                    </p>
                    {board === "improvement" && !r.insufficientData && (
                      <p className="row-meta">{r.baselineKg} kg → {r.currentKg} kg over the last two months</p>
                    )}
                    {board === "absolute" && !r.noData && r.savedKg > 0 && (
                      <p className="row-meta">{r.savedKg} kg saved versus baseline</p>
                    )}
                  </div>
                  <div className="row-value">{renderValue(r)}</div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
