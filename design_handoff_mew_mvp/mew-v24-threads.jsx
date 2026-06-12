// mew-v24-threads.jsx — "loose threads": overlapping + background + pickupable work.
// Architecture: blocks gain attention:'focus'|'background' + optional due. The tray
// is a DERIVED query (open ∧ not-current-focus), grouped by computed state.
// Three surfacings on the Noir dial: D1 dock · D2 outer constraint-ring · D3 reveal drawer.

// background / deadline-bound work — runs without holding your attention
const BG_TASKS = [
  { title: "iPhone swap", started: 8.0, due: 13.0, needsH: 3, pct: 0.55 },
];
// the full "loose threads" set (derived in production from block state)
const THREADS = [
  { st: "running", title: "iPhone swap", meta: "runs till 1:00pm · 1h20 left", tag: "work" },
  { st: "slipped", title: "Reply to landlord", meta: "window passed 9:00 · 15 min", tag: "private" },
  { st: "paused", title: "Spec review", meta: "interrupted · ~40% in", tag: "work" },
  { st: "unplaced", title: "Call the bank", meta: "captured · needs a home", tag: "private" },
];
const ST = {
  running:  { g: "◐", label: "running",  c: "var(--ice)" },
  slipped:  { g: "↪", label: "slipped",  c: "var(--gold)" },
  paused:   { g: "‖", label: "paused",   c: "var(--muted)" },
  unplaced: { g: "○", label: "unplaced", c: "var(--faint)" },
};

const ThreadStyles = () => (
  <style>{`
  /* outer constraint band overlay sits in the dial's relative box */
  .th-overlay{ position:absolute; inset:0; pointer-events:none; }
  .th-band-lbl{ font-family:'JetBrains Mono',monospace; font-size:10px; fill:var(--gold); font-weight:600; }

  /* D1 — dock */
  .th-dock{ display:flex; align-items:center; gap:10px; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line); border-radius:14px; padding:9px 12px; max-width:760px; }
  .th-dock .dlabel{ font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); white-space:nowrap; }
  .th-chip{ display:inline-flex; align-items:center; gap:7px; background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:5px 11px; cursor:pointer; transition:border-color .16s; white-space:nowrap; }
  .th-chip:hover{ border-color:var(--ice-bd); }
  .th-chip .g{ font-family:'JetBrains Mono',monospace; font-size:11px; }
  .th-chip .tt{ font-family:'Hanken Grotesk',sans-serif; font-size:12px; font-weight:600; color:var(--ink); }
  .th-chip .mm{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--muted); }

  /* D3 — reveal drawer */
  .th-pill{ display:inline-flex; align-items:center; gap:8px; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line); border-radius:999px; padding:7px 14px; cursor:pointer; transition:border-color .18s, box-shadow .18s; }
  .th-pill:hover{ border-color:var(--ice-bd); box-shadow:0 0 0 3px var(--ice-soft); }
  .th-pill .pd{ width:7px; height:7px; border-radius:50%; background:var(--ice); box-shadow:0 0 8px var(--glowc); }
  .th-pill .pt{ font-family:'Hanken Grotesk',sans-serif; font-size:12.5px; font-weight:650; color:var(--ink); }
  .th-pill .pc{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); }
  .th-drawer{ width:312px; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line); border-radius:16px; padding:14px 16px; box-shadow:0 24px 60px -18px rgba(0,0,0,.65); }
  .th-grp{ font-family:'JetBrains Mono',monospace; font-size:8.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin:12px 0 7px; display:flex; align-items:center; gap:7px; }
  .th-grp:first-child{ margin-top:0; }
  .th-grp::after{ content:""; flex:1; height:1px; background:var(--line2); }
  .th-row{ display:flex; align-items:center; gap:10px; padding:7px 8px; border-radius:9px; cursor:pointer; transition:background .15s; }
  .th-row:hover{ background:var(--bg); }
  .th-row .rg{ font-family:'JetBrains Mono',monospace; font-size:12px; width:14px; text-align:center; flex:none; }
  .th-row .rt{ font-size:13px; font-weight:600; color:var(--ink); }
  .th-row .rm{ font-family:'JetBrains Mono',monospace; font-size:9.5px; color:var(--muted); margin-top:1px; }
  .th-row .rpin{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); opacity:0; transition:opacity .15s; }
  .th-row:hover .rpin{ opacity:1; }
  `}</style>
);

// the outer band: a background task drawn from now → its deadline, on the rim
function OuterBand({ g = NXG }) {
  const rb = g.ro + 34;
  return (
    <svg className="th-overlay" width={g.w} height={g.h} viewBox={`-${g.ox} 0 ${g.w} ${g.h}`}>
      {BG_TASKS.map((t, i) => {
        const d0 = spDeg(NOW_H), d1 = spDeg(t.due);
        const [tx, ty] = rPolar(g.cx, g.cy, rb, d1);
        const [mx, my] = rPolar(g.cx, g.cy, rb + 16, (d0 + d1) / 2);
        return (
          <g key={i}>
            <path d={rArc(g.cx, g.cy, rb + i * 12, d0, d1)} fill="none" stroke="var(--gold)" strokeWidth="3"
              strokeLinecap="round" strokeDasharray="1 5" opacity=".7" />
            <circle cx={tx} cy={ty} r="4.5" fill="var(--gold)" style={{ filter: "drop-shadow(0 0 7px var(--glowc))" }} />
            <text x={tx} y={ty - 12} textAnchor="middle" className="th-band-lbl">due {fmtH(t.due)}</text>
            <text x={mx} y={my} textAnchor="middle" dominantBaseline="central"
              style={{ fill: "var(--gold)", fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600 }}>{t.title} ◐</text>
          </g>
        );
      })}
    </svg>
  );
}

function ThreadShell({ children, badge, pet = "cat" }) {
  return (
    <div className="stl nx ns sys" data-pet={pet} style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)", position: "relative" }}>
      <div className="sys-wash"></div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 16, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <NxClock /><span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}><span className="seg2"><span className="on">Focus</span><span>Week</span></span></div>
        {children}
      </div>
      <RightColumn petName="Pixie" petId={pet} />
    </div>
  );
}

/* D1 — the dock (refined agent proposal) */
function SurfaceThreadsDock() {
  return (
    <ThreadShell>
      <div style={{ position: "relative", width: NXG.w, height: NXG.h, marginTop: -26 }}>
        <NxFocus reveal />
      </div>
      <div className="th-dock" style={{ marginTop: -44, zIndex: 6 }}>
        <span className="dlabel">loose<br />threads</span>
        {THREADS.map((t, i) => (
          <span key={i} className="th-chip">
            <span className="g" style={{ color: ST[t.st].c }}>{ST[t.st].g}</span>
            <span><span className="tt">{t.title}</span> <span className="mm">{ST[t.st].label}</span></span>
          </span>
        ))}
      </div>
    </ThreadShell>
  );
}

/* D2 — the outer constraint-ring (everything stays on the dial) */
function SurfaceThreadsRing() {
  return (
    <ThreadShell>
      <div style={{ position: "relative", width: NXG.w, height: NXG.h }}>
        <NxFocus reveal />
        <OuterBand />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", pointerEvents: "none" }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>rim · running &amp; due — inner · what holds you</span>
        </div>
      </div>
    </ThreadShell>
  );
}

/* D3 — reveal drawer (clean at rest, full picture on demand) + the rim band */
function SurfaceThreadsDrawer({ open: openDefault = false }) {
  const [open, setOpen] = React.useState(openDefault);
  const groups = ["running", "slipped", "paused", "unplaced"];
  return (
    <ThreadShell>
      <div style={{ position: "relative", width: NXG.w, height: NXG.h }}>
        <NxFocus reveal />
        <OuterBand />
        {/* the closed pill — bottom-center of the dial */}
        {!open && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 30, display: "flex", justifyContent: "center" }}>
            <span className="th-pill" onClick={() => setOpen(true)}>
              <span className="pd"></span><span className="pt">4 loose threads</span>
              <span className="pc">1 running · 1 slipped · 2 waiting</span>
            </span>
          </div>
        )}
        {/* the drawer */}
        {open && (
          <div style={{ position: "absolute", right: 2, top: "42%", transform: "translateY(-50%)" }}>
            <div className="th-drawer">
              <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Loose threads</span>
                <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--faint)", cursor: "pointer" }} onClick={() => setOpen(false)}>close ✕</span>
              </div>
              {groups.map((grp) => {
                const rows = THREADS.filter((t) => t.st === grp);
                if (!rows.length) return null;
                return (
                  <div key={grp}>
                    <div className="th-grp">{ST[grp].label}</div>
                    {rows.map((t, i) => (
                      <div key={i} className="th-row">
                        <span className="rg" style={{ color: ST[t.st].c }}>{ST[t.st].g}</span>
                        <span style={{ minWidth: 0 }}><div className="rt">{t.title}</div><div className="rm">{t.meta}</div></span>
                        <span className="rpin">{grp === "running" ? "open" : grp === "unplaced" ? "place" : "resume"}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ThreadShell>
  );
}

Object.assign(window, { ThreadStyles, BG_TASKS, THREADS, OuterBand, ThreadShell, SurfaceThreadsDock, SurfaceThreadsRing, SurfaceThreadsDrawer });
