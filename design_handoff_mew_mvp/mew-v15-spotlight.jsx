// mew-v15-spotlight.jsx — SPOTLIGHT finalized, three 2026 AI-first treatments.
// Principle shift: hierarchy by SIZE & WEIGHT, not translucency. Everything
// on screen is fully legible; the future is smaller, not ghosted.
// F1 Instrument — telemetry-grade clarity, labeled future arcs.
// F2 Living Glass — agentic depth: glass core, real actions, agent trace.
// F3 Bento — editorial: oversized numerals + solid info tiles around the dial.

const SpStyles = () => (
  <style>{`
  .sp-count{ font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-0.035em; line-height:.95; }
  .sp-count small{ font-weight:600; color:var(--muted); }
  .sp-task{ font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:-0.018em; }
  .sp-lbl{ font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  .sp-arc-lbl{ font-family:'Hanken Grotesk',sans-serif; font-size:12px; font-weight:650; }
  .sp-arc-lbl.w{ fill:var(--ice); } .sp-arc-lbl.p{ fill:var(--teal); }
  .sp-arc-lbl .tm{ font-family:'JetBrains Mono',monospace; font-size:9.5px; fill:var(--muted); font-weight:500; }
  .sp-glass{ background:linear-gradient(160deg, rgba(30,42,58,.96), rgba(20,29,41,.98)); border:1px solid rgba(130,180,232,.28); border-radius:26px; box-shadow:0 30px 70px -30px rgba(0,0,0,.8), inset 0 1px 0 rgba(220,235,250,.09); }
  .sp-act{ font-family:'Hanken Grotesk',sans-serif; font-size:13px; font-weight:700; padding:9px 18px; border-radius:11px; cursor:pointer; white-space:nowrap; }
  .sp-act.pri{ background:var(--ice); color:#0b1118; box-shadow:0 4px 18px -4px rgba(130,180,232,.5); }
  .sp-act.sec{ border:1.4px solid var(--line); color:var(--ink); background:var(--panel2); }
  .sp-trace{ font-family:'JetBrains Mono',monospace; font-size:10.5px; color:var(--muted); display:flex; align-items:center; gap:8px; }
  .sp-trace::before{ content:""; width:6px; height:6px; border-radius:50%; background:var(--teal); box-shadow:0 0 8px var(--teal); animation:stlPulse 3s ease-in-out infinite; }
  .sp-tile{ background:var(--panel2); border:1.4px solid var(--line); border-radius:18px; padding:15px 18px; }
  .sp-tile .tl{ font-family:'JetBrains Mono',monospace; font-size:9.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--muted); font-weight:700; }
  .sp-tile .tv{ font-family:'Space Grotesk',sans-serif; font-size:21px; font-weight:700; margin-top:6px; letter-spacing:-0.02em; }
  .sp-tile .tv small{ font-size:13px; color:var(--muted); font-weight:600; }
  .sp-tile .tc{ font-size:12px; color:var(--muted); margin-top:4px; font-weight:500; }
  .sp-wedge{ animation:spWedge 5.5s ease-in-out infinite; transform-origin:center; }
  @keyframes spWedge{ 0%,100%{ opacity:.10; } 50%{ opacity:.16; } }
  @media (prefers-reduced-motion: reduce){ .sp-wedge{ animation:none; } }
  `}</style>
);

const SP = { cx: 310, cy: 310 };
const spDeg = (h) => ((h - NOW_H) / 12) * 360;
const BLOCK_END = 11.5;

function SpWedge({ ro, cx = SP.cx, cy = SP.cy }) {
  const [x0, y0] = rPolar(cx, cy, ro + 12, 0);
  const [x1, y1] = rPolar(cx, cy, ro + 12, spDeg(BLOCK_END));
  return <path className="sp-wedge" d={`M ${cx} ${cy} L ${x0} ${y0} A ${ro + 12} ${ro + 12} 0 0 1 ${x1} ${y1} Z`} fill="var(--ice)" />;
}

function SpNow({ ro, cx = SP.cx, cy = SP.cy }) {
  const [x, y] = rPolar(cx, cy, ro, 0);
  return (
    <g>
      <circle cx={x} cy={y} r="8" fill="#dcebfa" style={{ filter: "drop-shadow(0 0 14px rgba(130,180,232,1))" }} />
      <text x={x} y={y - 22} textAnchor="middle" style={{ fill: "var(--ice)", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700 }}>now · {fmtH(NOW_H)}</text>
    </g>
  );
}

/* future blocks: full color, thinner — hierarchy by weight, not ghosting */
function SpArcs({ ro, ri, nowW = 24, futW = 9, cx = SP.cx, cy = SP.cy }) {
  const vis = DAYBLOCKS.Tue.filter(([s, e]) => e > NOW_H && s < NOW_H + 11.2);
  return (
    <g>
      {vis.map((b, i) => {
        const [s, e, , tag, f = {}] = b;
        const work = tag === "work";
        const r = work ? ro : ri;
        return (
          <path key={i} d={rArc(cx, cy, r, spDeg(Math.max(s, NOW_H)), spDeg(e))} fill="none"
            stroke={work ? "var(--ice)" : "var(--teal)"} strokeWidth={f.now ? nowW : futW} strokeLinecap="round"
            strokeDasharray={tag === "rest" ? "2 6" : "none"}
            style={f.now ? { filter: "drop-shadow(0 0 11px rgba(130,180,232,.8))" } : {}} />
        );
      })}
    </g>
  );
}

function SpRings({ ro, ri, cx = SP.cx, cy = SP.cy }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={ro} fill="none" stroke="var(--line)" strokeWidth="1.4" />
      <circle cx={cx} cy={cy} r={ri} fill="none" stroke="var(--line)" strokeWidth="1.4" opacity=".75" />
    </g>
  );
}

/* F1 · INSTRUMENT — labeled future, telemetry footer, everything legible */
function SpotF1() {
  const ro = 270, ri = 230;
  const future = DAYBLOCKS.Tue.filter(([s]) => s > NOW_H);
  return (
    <div style={{ position: "relative", width: 824, height: 620 }}>
      <svg width="824" height="620" viewBox="-110 0 824 620">
        <SpRings ro={ro} ri={ri} />
        <SpWedge ro={ro} />
        <SpArcs ro={ro} ri={ri} />
        {future.map((b, i) => {
          const [s, e, title, tag] = b;
          const short = title.length > 12 ? title.slice(0, 10) + "\u2026" : title;
          const mid = (Math.max(s, NOW_H) + e) / 2;
          const stag = 36 + (i % 2) * 22;
          const [lx, ly] = rPolar(SP.cx, SP.cy, ro + stag, spDeg(mid));
          const anchor = lx > SP.cx + 14 ? "start" : lx < SP.cx - 14 ? "end" : "middle";
          return (
            <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="central" className={"sp-arc-lbl " + (tag === "work" ? "w" : "p")}>
              {short} <tspan className="tm">{fmtH(s)}</tspan>
            </text>
          );
        })}
        <SpNow ro={ro} />
      </svg>
      <div className="clk-center" style={{ width: 330 }}>
        <div className="sp-count" style={{ fontSize: 92 }}>40:00</div>
        <div className="sp-lbl" style={{ margin: "8px 0 12px" }}>remaining · held until 11:30</div>
        <div className="sp-task" style={{ fontSize: 27 }}>Finish the Q3 deck.</div>
        <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "var(--ink)" }}>
          <span style={{ color: "var(--gold)", fontWeight: 700 }}>★ 5 mews</span> · guard on · 2 switches
        </div>
      </div>
    </div>
  );
}

/* F2 · LIVING GLASS — agentic core: actions + a visible agent trace */
function SpotF2() {
  const ro = 274, ri = 236;
  return (
    <div style={{ position: "relative", width: 620, height: 620 }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(130,180,232,.14), transparent 65%)" }}></div>
      <svg width="620" height="620" viewBox="0 0 620 620" style={{ position: "relative" }}>
        <SpRings ro={ro} ri={ri} />
        <SpWedge ro={ro} />
        <SpArcs ro={ro} ri={ri} nowW={26} futW={10} />
        <SpNow ro={ro} />
      </svg>
      <div className="sp-glass clk-center" style={{ width: 350, padding: "30px 30px 26px", backdropFilter: "none" }}>
        <div className="sp-lbl">deep work · held until 11:30</div>
        <div className="sp-count" style={{ fontSize: 74, margin: "10px 0 4px" }}>40<small style={{ fontSize: 26 }}>:00</small></div>
        <div className="sp-task" style={{ fontSize: 24, marginBottom: 18 }}>Finish the Q3 deck.</div>
        <div style={{ display: "flex", gap: 9, justifyContent: "center" }}>
          <span className="sp-act pri">Done — a mew</span>
          <span className="sp-act sec">+15 min</span>
          <span className="sp-act sec">Move</span>
        </div>
        <div className="sp-trace" style={{ justifyContent: "center", marginTop: 18 }}>guarding — 2 pings held back · drift armed</div>
      </div>
    </div>
  );
}

/* F3 · BENTO — the dial among solid, oversized info tiles */
function SpotF3() {
  const c = 215, ro = 192, ri = 160;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 430px 180px", gap: 10, alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="sp-tile">
          <div className="tl">next up</div>
          <div className="tv" style={{ fontSize: 17 }}>Team standup</div>
          <div className="tc">11:30 · 30 min</div>
        </div>
        <div className="sp-tile">
          <div className="tl">mewmentum</div>
          <div className="tv" style={{ color: "var(--gold)" }}>5 <small>mews</small></div>
          <div className="tc">best day this week</div>
        </div>
      </div>

      <div style={{ position: "relative", width: 430, height: 430, justifySelf: "center" }}>
        <svg width="430" height="452" viewBox="0 -22 430 452">
          <SpRings ro={ro} ri={ri} cx={c} cy={c} />
          <SpWedge ro={ro} cx={c} cy={c} />
          <SpArcs ro={ro} ri={ri} nowW={18} futW={7} cx={c} cy={c} />
          <SpNow ro={ro} cx={c} cy={c} />
        </svg>
        <div className="clk-center" style={{ width: 230 }}>
          <div className="sp-count" style={{ fontSize: 58 }}>40:00</div>
          <div className="sp-lbl" style={{ margin: "6px 0 9px", fontSize: 9 }}>held until 11:30</div>
          <div className="sp-task" style={{ fontSize: 19 }}>Finish the Q3 deck.</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="sp-tile">
          <div className="tl">pace</div>
          <div className="tv" style={{ color: "var(--teal)" }}>sustainable</div>
          <div className="tc">6.5h planned · best 5.5</div>
        </div>
        <div className="sp-tile">
          <div className="tl">rest at</div>
          <div className="tv">18:00</div>
          <div className="tc">earned · protected</div>
        </div>
      </div>
    </div>
  );
}

function SurfaceSpot({ variant = 1 }) {
  const Comp = variant === 1 ? SpotF1 : variant === 2 ? SpotF2 : SpotF3;
  return (
    <div className="stl" style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 20, right: 24 }}>
          <span className="seg2"><span className="on">Focus</span><span>Week</span></span>
        </div>
        <Comp />
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { SpStyles, SurfaceSpot });
