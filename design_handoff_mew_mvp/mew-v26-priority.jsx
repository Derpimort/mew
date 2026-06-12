// mew-v26-priority.jsx — ALL ITEMS AS THIN ARCS. No thick hero highlight.
// Priority (focus | background) decides only brightness + the center.
// One click on any arc/label = promote to focus; click the focus' demote chip
// = let it run in background. Three geometries: P1 orbit lanes · P2 semantic
// rings + auto-stagger · P3 mono ring + dots.

const PG = { cx: 300, cy: 300, ro: 252, ri: 212, w: 760, h: 600, ox: 110 };

const P_ITEMS = [
  { title: "Finish the Q3 deck", s: 9.0, e: 11.5, tag: "work", held: true },
  { title: "iPhone swap", s: 8.0, e: 13.0, tag: "work", due: true },
  { title: "Watch CI deploy", s: 9.0, e: 10.5, tag: "work" },
  { title: "Reply to Sam", s: 9.25, e: 10.0, tag: "work" },
  { title: "Team standup", s: 11.5, e: 12.0, tag: "work" },
  { title: "Lunch, away", s: 13.0, e: 14.0, tag: "life" },
  { title: "Walk", s: 16.0, e: 17.0, tag: "life" },
];
const pVisible = (it) => it.e > NOW_H && it.s < NOW_H + 11.2;
const pRunning = (it) => it.s <= NOW_H && it.e > NOW_H;
const fmtDur = (h) => { const m = Math.round(h * 60); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); };

const PriStyles = () => (
  <style>{`
  .pri-arc{ cursor:pointer; transition:opacity .18s; }
  .pri-lbl{ cursor:pointer; }
  .pri-lbl:hover tspan, .pri-lbl:hover{ opacity:1 !important; }
  .pri-demote{ display:inline-flex; align-items:center; gap:6px; margin-top:13px; font-family:'JetBrains Mono',monospace; font-size:9.5px; color:var(--faint); border:1px solid var(--line); border-radius:999px; padding:4px 11px; cursor:pointer; transition:color .15s, border-color .15s; }
  .pri-demote:hover{ color:var(--gold); border-color:var(--ice-bd); }
  .pri-hint{ font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--faint); }
  `}</style>
);

function PriCenter({ item, next, onDemote }) {
  if (!item) return (
    <div className="clk-center" style={{ width: 300 }}>
      <div className="nx-task" style={{ fontSize: 24, color: "var(--muted)" }}>Nothing holds you.</div>
      <div className="nx-mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 10 }}>everything is running on its own · next: {next}</div>
    </div>
  );
  const meta = item.due ? "remaining · due " + fmtH(item.e) : item.held ? "remaining · held until " + fmtH(item.e) : "remaining · until " + fmtH(item.e);
  return (
    <div className="clk-center" style={{ width: 310 }}>
      <div className="nx-count" style={{ fontSize: 84 }}>{fmtDur(item.e - Math.max(item.s, NOW_H))}</div>
      <div className="nx-mono" style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", margin: "7px 0 10px", fontWeight: 600 }}>{meta}</div>
      <div className="nx-task" style={{ fontSize: 25 }}>{item.title}</div>
      <span className="pri-demote" onClick={onDemote}>↓ let it run in background</span>
    </div>
  );
}

function PriArc({ it, i, r, focus, hover, setHover, setFocus, dotOnly, lx, ly }) {
  const isF = focus === i;
  const col = it.due && !isF ? "var(--gold)" : it.tag === "work" ? "var(--ice)" : "var(--teal)";
  const op = isF ? 1 : hover === i ? 0.85 : 0.4;
  const d0 = spDeg(Math.max(it.s, NOW_H)), d1 = spDeg(it.e);
  const [ex, ey] = rPolar(PG.cx, PG.cy, r, d1);
  const onRight = lx > PG.cx;
  const handlers = { onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null), onClick: () => setFocus(i) };
  const moved = Math.abs(ly - ey) > 7 || Math.abs(lx - (ex + (onRight ? 9 : -9))) > 12;
  return (
    <g>
      {!dotOnly && (
        <path className="pri-arc" d={rArc(PG.cx, PG.cy, r, d0, d1)} fill="none" stroke={col} strokeWidth={isF ? 5 : 3.5}
          strokeLinecap="round" strokeDasharray={it.due ? "1 5" : "none"} opacity={op}
          style={isF ? { filter: "drop-shadow(0 0 9px var(--glowc))" } : {}} {...handlers} />
      )}
      <circle cx={ex} cy={ey} r={isF ? 5 : 3.5} fill={col} opacity={Math.min(op + 0.15, 1)}
        style={isF ? { filter: "drop-shadow(0 0 8px var(--glowc))" } : {}} className="pri-arc" {...handlers} />
      {moved && <line x1={ex} y1={ey} x2={lx + (onRight ? -4 : 4)} y2={ly} stroke={col} strokeWidth="1" opacity={op * 0.5} />}
      <text className="pri-lbl" x={lx} y={ly} textAnchor={onRight ? "start" : "end"} dominantBaseline="central"
        opacity={isF ? 1 : 0.55} {...handlers}
        style={{ fill: isF ? "var(--ink)" : col, fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, fontWeight: 650 }}>
        {it.title} <tspan style={{ fill: "var(--muted)", fontFamily: "'JetBrains Mono',monospace", fontSize: 9 }}>{it.due ? "due " : pRunning(it) ? "→ " : ""}{fmtH(it.due || pRunning(it) ? it.e : it.s)}</tspan>
      </text>
    </g>
  );
}

// greedy label de-collision: per side, sorted by y, enforce a minimum gap
function resolveLabels(vis, radii, layout) {
  const raw = vis.map(([it], k) => {
    const deg = spDeg(it.e);
    const [ex, ey] = rPolar(PG.cx, PG.cy, radii[k], deg);
    // lanes: callout labels live outside the dial, leader lines bridge
    const [lxr, lyr] = layout === "lanes" ? rPolar(PG.cx, PG.cy, PG.ro + 18, deg) : [ex, ey];
    const onRight = lxr >= PG.cx;
    return { k, x: lxr + (onRight ? 9 : -9), y: lyr, right: onRight };
  });
  for (const side of [true, false]) {
    const grp = raw.filter((l) => l.right === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < grp.length; i++) {
      if (grp[i].y - grp[i - 1].y < 17) grp[i].y = grp[i - 1].y + 17;
    }
  }
  const out = []; raw.forEach((l) => { out[l.k] = l; });
  return out;
}

function radiiFor(layout, vis, focus) {
  // returns array of radii parallel to vis
  if (layout === "lanes") {
    // focus owns the outer orbit; everyone else steps inward by priority (running first)
    const order = vis.map(([it, i]) => i).sort((a, b) => (a === focus ? -1 : b === focus ? 1 : 0));
    const map = {};
    order.forEach((idx, k) => { map[idx] = PG.ro - k * 14; });
    return vis.map(([, i]) => map[i]);
  }
  if (layout === "rings") {
    // semantic rings (work outer / life inner) + auto-stagger only while overlapping
    const placed = [];
    return vis.map(([it, i]) => {
      const base = it.tag === "work" ? PG.ro : PG.ri;
      let k = 0;
      while (placed.some((p) => p.base === base && p.k === k && p.s < it.e && it.s < p.e)) k++;
      placed.push({ base, k, s: Math.max(it.s, NOW_H), e: it.e });
      return base + (base === PG.ro ? k * 12 : -k * 12);
    });
  }
  return vis.map(() => PG.ro); // mono
}

function SurfacePri({ layout = "lanes", defaultFocus = 0 }) {
  const [focus, setFocus] = React.useState(defaultFocus);
  const [hover, setHover] = React.useState(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const vis = P_ITEMS.map((it, i) => [it, i]).filter(([it]) => pVisible(it));
  const radii = radiiFor(layout, vis, focus);
  const labels = resolveLabels(vis, radii, layout);
  const fItem = focus != null ? P_ITEMS[focus] : null;
  const nextUp = P_ITEMS.filter((it) => it.s > NOW_H)[0];
  return (
    <div className="stl nx ns sys" data-pet="cat" style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)", position: "relative" }}>
      <div className="sys-wash"></div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 16, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <NxClock /><span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}><span className="seg2"><span className="on">Focus</span><span>Week</span></span></div>

        <div style={{ position: "relative", width: PG.w, height: PG.h }}>
          <svg width={PG.w} height={PG.h} viewBox={`-${PG.ox} 0 ${PG.w} ${PG.h}`}>
            <circle cx={PG.cx} cy={PG.cy} r={PG.ro} fill="none" stroke="var(--line)" strokeWidth="1.2" />
            {layout !== "mono" && <circle cx={PG.cx} cy={PG.cy} r={PG.ri} fill="none" stroke="var(--line)" strokeWidth="1.2" opacity=".5" />}
            {vis.map(([it, i], k) => (
              <PriArc key={i} it={it} i={i} r={radii[k]} focus={focus} hover={hover} setHover={setHover} setFocus={setFocus}
                lx={labels[k].x} ly={labels[k].y}
                dotOnly={layout === "mono" && !pRunning(it) && focus !== i} />
            ))}
            {(() => { const [x, y] = rPolar(PG.cx, PG.cy, PG.ro, 0); return (
              <g><circle cx={x} cy={y} r="6.5" fill="var(--ice)" style={{ filter: "drop-shadow(0 0 12px var(--glowc))" }} />
              <text x={x} y={y - 18} textAnchor="middle" style={{ fill: "var(--ice)", fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>now · {fmtH(NOW_H)}</text></g>
            ); })()}
          </svg>
          <PriCenter item={fItem} next={nextUp ? nextUp.title + " " + fmtH(nextUp.s) : "—"} onDemote={() => setFocus(null)} />
          {/* F1 rail (blessed) */}
          {!railOpen ? (
            <div className="frail" onClick={() => setRailOpen(true)}>
              <span className="cnt">4</span>
              {THREADS.map((t, i) => <span key={i} className="dot" style={{ background: i === 0 ? "var(--ice)" : i === 1 ? "var(--gold)" : i === 2 ? "var(--muted)" : "var(--faint)" }}></span>)}
              <span className="vlabel">threads</span>
            </div>
          ) : (
            <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", zIndex: 9 }}><ThreadBox onClose={() => setRailOpen(false)} /></div>
          )}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 18, textAlign: "center" }}>
            <span className="pri-hint">click any item to focus it · click the chip to let it run</span>
          </div>
        </div>
      </div>
      <RightColumn petName="Pixie" petId="cat" />
    </div>
  );
}

Object.assign(window, { PriStyles, SurfacePri, P_ITEMS, PriArc, PriCenter, resolveLabels, radiiFor, PG, pRunning, pVisible, fmtDur });
