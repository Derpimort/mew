// mew-v25-focus.jsx — SIMPLER Focus. The center returns to one thing; the rim
// carries everything that's running now (each arc → its own end, bg gets a due
// tick); a calm VERTICAL box manages "loose threads" on demand.
// Three homes for the box: F1 left rail · F2 slide-over · F3 corner dock.

const STx = {
  running:  { g: "◐", label: "running",  c: "var(--ice)" },
  slipped:  { g: "↪", label: "slipped",  c: "var(--gold)" },
  paused:   { g: "‖", label: "paused",   c: "var(--muted)" },
  unplaced: { g: "○", label: "unplaced", c: "var(--faint)" },
};

// everything running right now, beyond the single hero block → shown on the rim
const RUNNING = [
  { title: "iPhone swap", end: 13.0, due: true, tag: "work" },
  { title: "Watch CI deploy", end: 10.5, tag: "work" },
  { title: "Reply to Sam", end: 10.0, tag: "private" },
];

const FocusStyles = () => (
  <style>{`
  .sf-rimlbl{ font-family:'Hanken Grotesk',sans-serif; font-size:11px; font-weight:600; }
  .sf-rimt{ font-family:'JetBrains Mono',monospace; font-size:9px; }

  /* shared vertical thread box */
  .tbox{ width:262px; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line); border-radius:16px; padding:13px 15px; box-shadow:0 24px 60px -18px rgba(0,0,0,.6); }
  .tbox-h{ display:flex; align-items:center; margin-bottom:6px; }
  .tbox-h .t{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:13.5px; }
  .tbox-h .x{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--faint); cursor:pointer; }
  .tgrp{ font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin:11px 0 6px; display:flex; align-items:center; gap:7px; }
  .tgrp:first-of-type{ margin-top:2px; } .tgrp::after{ content:""; flex:1; height:1px; background:var(--line2); }
  .trow{ display:flex; align-items:center; gap:9px; padding:6px 7px; border-radius:9px; cursor:pointer; }
  .trow:hover{ background:var(--bg); }
  .trow .g{ font-family:'JetBrains Mono',monospace; font-size:11px; width:13px; text-align:center; flex:none; }
  .trow .tt{ font-size:12.5px; font-weight:600; color:var(--ink); }
  .trow .mm{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--muted); margin-top:1px; }
  .trow .pin{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:8.5px; color:var(--faint); opacity:0; }
  .trow:hover .pin{ opacity:1; }

  /* F1 — left rail (collapsed) */
  .frail{ position:absolute; left:18px; top:50%; transform:translateY(-50%); display:flex; flex-direction:column; align-items:center; gap:10px; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line); border-radius:999px; padding:12px 9px; cursor:pointer; transition:border-color .18s; z-index:8; }
  .frail:hover{ border-color:var(--ice-bd); }
  .frail .cnt{ font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:15px; color:var(--ink); }
  .frail .dot{ width:8px; height:8px; border-radius:50%; }
  .frail .vlabel{ writing-mode:vertical-rl; font-family:'JetBrains Mono',monospace; font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }

  /* F3 — corner dock */
  .fdock{ position:absolute; left:20px; bottom:22px; width:236px; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line); border-radius:14px; padding:11px 13px; z-index:8; cursor:pointer; }
  .fdock .lead{ display:flex; align-items:center; gap:9px; }
  .fdock .lead .tt{ font-size:12.5px; font-weight:650; }
  .fdock .lead .mm{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--gold); }
  .fdock .more{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); margin-top:8px; padding-top:8px; border-top:1px solid var(--line2); }
  `}</style>
);

const FG = { cx: 300, cy: 300, ro: 250, ri: 210, w: 760, h: 600, ox: 110 };

function ThreadBox({ onClose }) {
  const groups = ["running", "slipped", "paused", "unplaced"];
  return (
    <div className="tbox">
      <div className="tbox-h"><span className="t">Loose threads</span>{onClose && <span className="x" onClick={onClose}>close ✕</span>}</div>
      {groups.map((grp) => {
        const rows = THREADS.filter((t) => t.st === grp);
        if (!rows.length) return null;
        return (
          <div key={grp}>
            <div className="tgrp">{STx[grp].label}</div>
            {rows.map((t, i) => (
              <div key={i} className="trow">
                <span className="g" style={{ color: STx[t.st].c }}>{STx[t.st].g}</span>
                <span style={{ minWidth: 0 }}><div className="tt">{t.title}</div><div className="mm">{t.meta}</div></span>
                <span className="pin">{grp === "running" ? "open" : grp === "unplaced" ? "place" : "resume"}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// simpler dial: one hero in the center, rim = everything running now
function SimpleFocus({ g = FG, reveal = true }) {
  const future = DAYBLOCKS.Tue.map((b, i) => [b, i]).filter(([b]) => b[0] > NOW_H && b[0] < NOW_H + 11.2);
  return (
    <svg width={g.w} height={g.h} viewBox={`-${g.ox} 0 ${g.w} ${g.h}`}>
      <circle cx={g.cx} cy={g.cy} r={g.ro} fill="none" stroke="var(--line)" strokeWidth="1.2" />
      <circle cx={g.cx} cy={g.cy} r={g.ri} fill="none" stroke="var(--line)" strokeWidth="1.2" opacity=".6" />

      {/* upcoming focus/life blocks — quiet */}
      {future.map(([b, i]) => {
        const [s, e, , tag] = b; const work = tag === "work";
        return <path key={i} d={rArc(g.cx, g.cy, work ? g.ro : g.ri, spDeg(s), spDeg(e))} fill="none"
          stroke={work ? "var(--ice)" : "var(--teal)"} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={tag === "rest" ? "2 6" : "none"} opacity=".5" />;
      })}
      {/* the hero (current) block — bright on the work ring */}
      <path d={rArc(g.cx, g.cy, g.ro, spDeg(NOW_H), spDeg(BLOCK_END))} fill="none" stroke="var(--ice)" strokeWidth="20"
        strokeLinecap="round" style={{ filter: "drop-shadow(0 0 10px var(--glowc))" }} />

      {/* RIM — everything running now, each → its own end */}
      {RUNNING.map((t, k) => {
        const rb = g.ro + 18 + k * 13;
        const d1 = spDeg(t.end);
        const [ex, ey] = rPolar(g.cx, g.cy, rb, d1);
        const [lx, ly] = rPolar(g.cx, g.cy, rb, (spDeg(NOW_H) + d1) / 2);
        const lab = lx > g.cx ? "start" : "end";
        return (
          <g key={k}>
            <path d={rArc(g.cx, g.cy, rb, spDeg(NOW_H), d1)} fill="none"
              stroke={t.due ? "var(--gold)" : t.tag === "work" ? "var(--ice)" : "var(--teal)"}
              strokeWidth="3" strokeLinecap="round" strokeDasharray={t.due ? "1 5" : "none"} opacity={t.due ? .8 : .55} />
            <circle cx={ex} cy={ey} r={t.due ? 4 : 3} fill={t.due ? "var(--gold)" : t.tag === "work" ? "var(--ice)" : "var(--teal)"}
              style={t.due ? { filter: "drop-shadow(0 0 6px var(--glowc))" } : {}} />
            <text x={ex + (lx > g.cx ? 8 : -8)} y={ey} textAnchor={lab} dominantBaseline="central"
              className="sf-rimlbl" style={{ fill: t.due ? "var(--gold)" : "var(--muted)" }}>
              {t.title} <tspan className="sf-rimt">{t.due ? "due " : "→ "}{fmtH(t.end)}</tspan>
            </text>
          </g>
        );
      })}

      {/* now marker */}
      {(() => { const [x, y] = rPolar(g.cx, g.cy, g.ro, 0); return (
        <g><circle cx={x} cy={y} r="6.5" fill="var(--ice)" style={{ filter: "drop-shadow(0 0 12px var(--glowc))" }} />
        <text x={x} y={y - 18} textAnchor="middle" className="sf-rimt" style={{ fill: "var(--ice)", fontSize: 11, fontWeight: 700 }}>now · {fmtH(NOW_H)}</text></g>
      ); })()}
    </svg>
  );
}

function FocusShell({ children }) {
  return (
    <div className="stl nx ns sys" data-pet="cat" style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)", position: "relative" }}>
      <div className="sys-wash"></div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 16, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <NxClock /><span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}><span className="seg2"><span className="on">Focus</span><span>Week</span></span></div>

        <div style={{ position: "relative", width: FG.w, height: FG.h }}>
          <SimpleFocus />
          <div className="clk-center" style={{ width: 300 }}>
            <div className="nx-count" style={{ fontSize: 86 }}>40:00</div>
            <div className="nx-mono" style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", margin: "7px 0 11px", fontWeight: 600 }}>remaining · held until 11:30</div>
            <div className="nx-task" style={{ fontSize: 26 }}>Finish the Q3 deck.</div>
            <div className="nx-mono" style={{ marginTop: 11, fontSize: 11 }}><span style={{ color: "var(--gold)", fontWeight: 700 }}>★ 5 mews</span><span style={{ color: "var(--muted)" }}> · guard on</span></div>
          </div>
          {children}
        </div>
      </div>
      <RightColumn petName="Pixie" petId="cat" />
    </div>
  );
}

/* F1 — left rail: collapsed dots → expands in place */
function SurfaceFocusRail({ open: od = false }) {
  const [open, setOpen] = React.useState(od);
  return (
    <FocusShell>
      {!open ? (
        <div className="frail" onClick={() => setOpen(true)}>
          <span className="cnt">4</span>
          {THREADS.map((t, i) => <span key={i} className="dot" style={{ background: STx[t.st].c }}></span>)}
          <span className="vlabel">threads</span>
        </div>
      ) : (
        <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}><ThreadBox onClose={() => setOpen(false)} /></div>
      )}
    </FocusShell>
  );
}

/* F2 — slide-over: trigger pill bottom, opens tall panel from right of dial */
function SurfaceFocusSlide({ open: od = false }) {
  const [open, setOpen] = React.useState(od);
  return (
    <FocusShell>
      {!open && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, display: "flex", justifyContent: "center" }}>
          <span className="th-pill" onClick={() => setOpen(true)}><span className="pd"></span><span className="pt">manage · 4 threads</span><span className="pc">1 running · 1 slipped · 2 waiting</span></span>
        </div>
      )}
      {open && <div style={{ position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)" }}><ThreadBox onClose={() => setOpen(false)} /></div>}
    </FocusShell>
  );
}

/* F3 — corner dock: always shows the most urgent, expands up */
function SurfaceFocusDock({ open: od = false }) {
  const [open, setOpen] = React.useState(od);
  return (
    <FocusShell>
      {!open ? (
        <div className="fdock" onClick={() => setOpen(true)}>
          <div className="lead"><span className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", boxShadow: "0 0 8px var(--glowc)" }}></span>
            <span style={{ minWidth: 0 }}><div className="tt">iPhone swap <span className="mm">running</span></div></span></div>
          <div className="more">due 1:00pm · 1h20 left · +3 more threads ↑</div>
        </div>
      ) : (
        <div style={{ position: "absolute", left: 20, bottom: 22 }}><ThreadBox onClose={() => setOpen(false)} /></div>
      )}
    </FocusShell>
  );
}

Object.assign(window, { FocusStyles, RUNNING, SimpleFocus, ThreadBox, FocusShell, SurfaceFocusRail, SurfaceFocusSlide, SurfaceFocusDock });
