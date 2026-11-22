"use client";
import { useEffect, useState } from "react";
import ChatPanel from "./chat-panel";
import LoginForm from "./login-form";

type Health = {
  client_id: string;
  client_name: string;
  score: number;
  label: string;
  rule_version?: number;
  signals?: { label: string; delta: number; detail: string; messageIds?: string[] }[];
  evidence?: {
    id: string;
    text: string;
    sender_name: string;
    sender_role: string;
    sent_at: string;
  }[];
};

type Plan = {
  assignments: {
    id: string;
    title: string;
    week: number;
    assignedTo?: string;
    reason: string;
    overCapacity?: boolean;
    missesDate?: boolean;
    suggestedFix: string;
    assignedToName?: string;
  }[];
  impossible: { title: string; reason: string; suggestedFix: string }[];
  summary: string;
  feasible: boolean;
  podUsage: Record<
    string,
    { name: string; planned: number; capacity: number; utilisation: number; fragile: boolean }
  >;
  personUsage: {
    id: string;
    name: string;
    podId: string;
    podName: string;
    tier: string;
    planned: number;
    capacity: number;
    utilisation: number;
    fragile: boolean;
    overCapacity: boolean;
  }[];
};

export default function Dashboard({
  signedIn,
  userName,
  role,
}: {
  signedIn: boolean;
  userName: string;
  role: string;
}) {
  const [tab, setTab] = useState("overview");
  const [health, setHealth] = useState<Health[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [baselinePlan, setBaselinePlan] = useState<Plan | null>(null);
  const [plannerError, setPlannerError] = useState<string>("");
  const [alerts, setAlerts] = useState<any[]>([]);
  const [scenario, setScenario] = useState("none");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Health | null>(null);

  async function load() {
    setBusy(true);
    setPlannerError("");
    try {
      const [hRes, pRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/planner"),
      ]);
      const h = await hRes.json();
      const p = await pRes.json();
      setHealth(h.clients || []);
      setAlerts(h.alerts || []);
      if (pRes.ok && p.plan) {
        setPlan(p.plan);
        setBaselinePlan(p.plan);
      } else {
        setPlan(null);
        setBaselinePlan(null);
        setPlannerError(p.error || "Planner unavailable for current role.");
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function simulate() {
    const firstPerson = baselinePlan?.personUsage[0]?.id || "person-01";
    const thirdPerson = baselinePlan?.personUsage[2]?.id || "person-03";
    const podLead = baselinePlan?.personUsage
      .filter((person) => person.tier === "lead")
      .sort((a, b) => b.planned - a.planned)[0];

    if (scenario === "lead" && !podLead) {
      setPlannerError("No employee with lead tier is available in the current planning scope.");
      return;
    }

    const body =
      scenario === "none"
        ? {}
        : scenario === "away"
          ? { awayPersonId: firstPerson, awayWeek: 2 }
          : scenario === "leave"
            ? { leavePersonId: thirdPerson }
            : scenario === "volume"
              ? { volumeMultiplier: 2 }
              : scenario === "new"
                ? { newClient: true }
                : scenario === "deadline"
                  ? { dueDateShiftDays: -5 }
                  : { podLeadAwayId: podLead!.id };

    const r = await fetch("/api/planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      setPlannerError(j.error || "Simulation failed.");
      return;
    }
    setPlannerError("");
    setPlan(j.plan);
  }

  return (
    <main className="shell">
      <header className="top">
        <div>
          <div className="brand">
            YOSO <span style={{ color: "#5477b8" }}>OS</span>
          </div>
          <div className="muted">Agency operations workspace · {userName}</div>
        </div>
        <div className="row">
          <span className="pill">Role: {role}</span>
          {signedIn ? (
            <span className="pill healthy">Authenticated</span>
          ) : (
            <span className="pill watch">Demo preview · sign in below</span>
          )}
        </div>
      </header>

      <LoginForm signedIn={signedIn} />

      <nav className="tabs">
        {[
          ["overview", "Overview"],
          ["planner", "Capacity planner"],
          ["health", "Client health"],
          ["chat", "Messages"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="grid">
            <div className="card">
              <div className="muted">Clients monitored</div>
              <div className="metric">{health.length}</div>
              <div className="muted">Weekly health snapshots</div>
            </div>
            <div className="card">
              <div className="muted">Planned deliverables</div>
              <div className="metric">{plan?.assignments.length ?? "—"}</div>
              <div className="muted">Four-week planning horizon</div>
            </div>
            <div className="card">
              <div className="muted">Unassigned / blocked</div>
              <div className="metric">{plan?.impossible.length ?? "—"}</div>
              <div className="muted">Requires capacity intervention</div>
            </div>
          </div>

          <section className="section card">
            <div className="row">
              <h2>Needs attention</h2>
              <button className="btn" onClick={load}>
                {busy ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {health.filter((x) => x.label !== "Healthy").length === 0 ? (
              <p className="muted">
                {signedIn
                  ? "No Watch or At risk clients in your scope."
                  : "Sign in to inspect your scoped clients."}
              </p>
            ) : (
              health
                .filter((x) => x.label !== "Healthy")
                .slice(0, 6)
                .map((x) => (
                  <div className="item" key={x.client_id}>
                    <span>{x.client_name}</span>
                    <span
                      className={`pill ${x.label === "Watch" ? "watch" : "risk"}`}
                    >
                      {x.score} · {x.label}
                    </span>
                  </div>
                ))
            )}
          </section>
        </>
      )}

      {tab === "health" && (
        <section className="card">
          <h2>Client health · weekly score (v1)</h2>
          <p className="muted">
            Sorted by urgency first. Scores are explainable heuristic signals (Mon–Fri
            09:00–18:00 IST).
          </p>
          <div className="list">
            {health.map((x) => (
              <div className="item" key={x.client_id}>
                <div>
                  <strong>{x.client_name}</strong>
                  <div className="muted">Click Why? to inspect rules and evidence</div>
                </div>
                <div className="row">
                  <span
                    className={`pill ${
                      x.label === "Healthy"
                        ? "healthy"
                        : x.label === "Watch"
                          ? "watch"
                          : "risk"
                    }`}
                  >
                    {x.score} · {x.label}
                  </span>
                  <button className="btn" onClick={() => setDetail(x)}>
                    Why?
                  </button>
                </div>
              </div>
            ))}
          </div>

          {alerts.length > 0 && (
            <div className="notice section">
              <strong>Recent downgrade alerts (deduplicated)</strong>
              {alerts.map((a) => (
                <p key={a.id}>
                  {a.from_label} → {a.to_label} · Week of {a.week_start}
                </p>
              ))}
            </div>
          )}

          {detail && (
            <div className="notice section">
              <div className="row">
                <strong>
                  {detail.client_name}: {detail.score}/100 ({detail.label})
                </strong>
                <button className="btn" onClick={() => setDetail(null)}>
                  Close
                </button>
              </div>
              {(detail.signals || []).length === 0 && (
                <p>Baseline score (70) with no negative or bonus triggers this week.</p>
              )}
              {(detail.signals || []).map((s, i) => (
                <div key={i} className="section">
                  <p>
                    <strong>{s.label}</strong> ({s.delta > 0 ? "+" : ""}
                    {s.delta}): {s.detail}
                  </p>
                  {role === "founder" ? (
                    <small className="muted">
                      Direct message text is restricted to assigned account managers;
                      signal rule and message count are shown.
                    </small>
                  ) : (
                    (detail.evidence || [])
                      .filter((m) => (s.messageIds || []).includes(m.id))
                      .map((m) => (
                        <blockquote key={m.id}>
                          “{m.text}” <small>— {m.sender_name}</small>
                        </blockquote>
                      ))
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "planner" && (
        <section className="card">
          <div className="row">
            <div>
              <h2>Four-week capacity planner</h2>
              <p className="muted">
                Greedy, low-disruption heuristic · what-if simulation never writes to the
                database.
              </p>
            </div>
            <button className="btn" onClick={load}>
              Reload baseline
            </button>
          </div>

          {plannerError ? (
            <div className="notice section">{plannerError}</div>
          ) : (
            <>
              <div className="actions">
                <select
                  className="field"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                >
                  <option value="none">Baseline</option>
                  <option value="away">Person away for week 2</option>
                  <option value="leave">Person leaves</option>
                  <option value="volume">Client volume doubles</option>
                  <option value="new">New client starts</option>
                  <option value="deadline">Due dates move earlier by 5 days</option>
                  <option value="lead">Pod lead away</option>
                </select>
                <button className="btn primary" onClick={simulate}>
                  Run what-if
                </button>
              </div>

              {plan && (
                <>
                  <p className={plan.feasible ? "pill healthy" : "notice"}>
                    {plan.summary}
                  </p>

                  <div className="section">
                    <h3>Pod utilisation · before vs after</h3>
                    <div className="grid">
                      {Object.entries(plan.podUsage).map(([pod, v]) => {
                        const before = baselinePlan?.podUsage[pod]?.utilisation ?? 0;
                        return (
                          <div className="card" key={pod}>
                            <strong>{v.name || pod}</strong>
                            <div className="row">
                              <span className="muted">Before</span>
                              <strong>{before}%</strong>
                            </div>
                            <div className="bar">
                              <span style={{ width: `${Math.min(before, 100)}%` }} />
                            </div>
                            <div className="row">
                              <span className="muted">After</span>
                              <strong>{v.utilisation}%</strong>
                            </div>
                            <div className="bar">
                              <span
                                style={{ width: `${Math.min(v.utilisation, 100)}%` }}
                              />
                            </div>
                            <small className="muted">
                              {v.planned}h / {v.capacity}h ·{" "}
                              {v.fragile ? "Fragile capacity (≥90%)" : "Capacity buffer"}
                            </small>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="section">
                    <h3>Employee utilisation after scenario</h3>
                    {plan.personUsage.map((p) => (
                      <div className="item" key={p.id}>
                        <div>
                          <strong>{p.name}</strong>
                          <div className="muted">
                            {p.podName || p.podId} · {p.planned}h / {p.capacity}h
                          </div>
                        </div>
                        <span
                          className={`pill ${
                            p.overCapacity
                              ? "risk"
                              : p.fragile
                                ? "watch"
                                : "healthy"
                          }`}
                        >
                          {p.utilisation}%{" "}
                          {p.overCapacity
                            ? "Over capacity"
                            : p.fragile
                              ? "Fragile"
                              : "Available"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="section">
                    <h3>Assignments</h3>
                    {plan.assignments.map((a) => (
                      <div className="item" key={a.id}>
                        <div>
                          <strong>{a.title}</strong>
                          <div className="muted">
                            Week {a.week} · {a.reason}
                          </div>
                          <div className="muted">Fix: {a.suggestedFix}</div>
                        </div>
                        <span
                          className={`pill ${
                            a.overCapacity || a.missesDate ? "risk" : "healthy"
                          }`}
                        >
                          {a.missesDate
                            ? "Due date conflict"
                            : a.assignedToName || a.assignedTo || "Unassigned"}
                        </span>
                      </div>
                    ))}
                  </div>

                  {plan.impossible.length > 0 && (
                    <div className="notice section">
                      <strong>Smallest next steps</strong>
                      {plan.impossible.map((x) => (
                        <p key={x.title}>
                          {x.title}: {x.reason} Suggested fix: {x.suggestedFix}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      {tab === "chat" && <ChatPanel />}

      <footer className="section muted">
        YOSO OS · Engineering assignment · Synthetic sample data only.
      </footer>
    </main>
  );
}
