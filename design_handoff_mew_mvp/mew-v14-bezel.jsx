// mew-v14-bezel.jsx — THE BEZEL, refined. Bigger elements, fewer marks, more focus.
// B1 Clear — bigger dial, thicker arcs, three quiet hour marks, no needle.
// B2 Queue — past drops off entirely; "up next" lives in the center.
// B3 Spotlight — the remaining time of the current block is the hero.

const BzStyles = () => (
  <style>{`
  .bz-title{ font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:-0.018em; }
  .bz-meta{ font-family:'JetBrains Mono',monospace; color:var(--muted); }
  .bz-meta b{ color:var(--gold); font-weight:600; }
  .bz-next{ margin-top:16px; padding-top:14px; border-top:1px solid var(--line2); text-align:left; display:inline-block; }
  .bz-next .nx{ display:flex; align-items:center; gap:9px; font-size:13px; color:var(--muted); padding:3.5px 0; white-space:nowrap; }
  .bz-next .nx i{ font-style:normal; font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--faint); width:38px; }
  .bz-next .nx .dotw{ width:8px; height:8px; border-radius:50%; flex:none; }
  .bz-count{ font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:64px; letter-spacing:-0.03em; line-height:1; }
  .bz-count small{ font-size:22px; font-weight:600; color:var(--muted); margin-left:2px; }
  `}</style>
);

const BZ = { cx: 310, cy: 310, size: 620 };
const bzDeg = (h) => ((h - NOW_H) / 12) * 360;

function BzDot({ r, label }) {
  const [x, y] = rPolar(BZ.cx, BZ.cy, r, 0);
  return (
    <g>
      <circle cx={x} cy={y} r="7" fill="#dcebfa" style={{ filter: "drop-shadow(0 0 12px rgba(130,180,232,.95))" }} />
      {label && <text x={x} y={y - 20} className="clk-lbl maj" textAnchor="middle" style={{ fill: "var(--ice)", fontSize: 11 }}>{label}</text>}
    </g>
  );
}

function BzMarks({ hours, r }) {
  return (
    <g>
      {hours.map((h) => {
        const [x, y] = rPolar(BZ.cx, BZ.cy, r, bzDeg(h));
        return <text key={h} x={x} y={y} className="clk-lbl" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 10.5 }}>{fmtH(h)}</text>;
      })}
    </g>
  );
}

function BzArcs({ ro, ri, blocks, wOuter = 19, futureOnly = false, dimAfter = null }) {
  const vis = blocks.filter(([s, e]) => (futureOnly ? e > NOW_H : e > NOW_H - 0.4) && s < NOW_H + 11.2);
  return (
    <g>
      {vis.map((b, i) => {
        const [s, e, , tag, f = {}] = b;
        const work = tag === "work";
        const r = work ? ro : ri;
        const s2 = Math.max(s, futureOnly ? NOW_H : s);
        let op = f.done ? .25 : f.now ? 1 : .6;
        if (dimAfter != null && s >= dimAfter) op = .3;
        return (
          <path key={i} d={rArc(BZ.cx, BZ.cy, r, bzDeg(s2), bzDeg(e))} fill="none"
            stroke={work ? "var(--ice)" : "var(--teal)"} strokeWidth={f.now ? wOuter + 5 : wOuter} strokeLinecap="round"
            strokeDasharray={tag === "rest" ? "4 7" : "none"} opacity={op}
            style={f.now ? { filter: "drop-shadow(0 0 10px rgba(130,180,232,.75))" } : {}} />
        );
      })}
    </g>
  );
}

/* B1 · CLEAR — the instrument, enlarged and silenced */
function BezelB1() {
  const ro = 268, ri = 226;
  return (
    <div style={{ position: "relative", width: BZ.size, height: BZ.size }}>
      <svg width={BZ.size} height={BZ.size} viewBox={`0 0 ${BZ.size} ${BZ.size}`}>
        <circle cx={BZ.cx} cy={BZ.cy} r={ro} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <circle cx={BZ.cx} cy={BZ.cy} r={ri} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".6" />
        <BzMarks hours={[NOW_H + 3, NOW_H + 6, NOW_H + 9].map(h => Math.round(h))} r={296} />
        <BzArcs ro={ro} ri={ri} blocks={DAYBLOCKS.Tue} />
        <BzDot r={ro} label={"now · " + fmtH(NOW_H)} />
      </svg>
      <div className="clk-center" style={{ width: 340 }}>
        <span className="clk-tag" style={{ fontSize: 10.5, padding: "4px 11px" }}>work · held</span>
        <div className="bz-title" style={{ fontSize: 34, margin: "12px 0 10px" }}>Finish the Q3 deck.</div>
        <div className="bz-meta" style={{ fontSize: 11.5 }}>40:00 left · until 11:30 · <b>5 mews</b></div>
      </div>
    </div>
  );
}

/* B2 · QUEUE — past drops off; what's next lives in the center */
function BezelB2() {
  const ro = 268, ri = 226;
  const upcoming = DAYBLOCKS.Tue.filter(([s, , , , f]) => s > NOW_H).slice(0, 3);
  return (
    <div style={{ position: "relative", width: BZ.size, height: BZ.size }}>
      <svg width={BZ.size} height={BZ.size} viewBox={`0 0 ${BZ.size} ${BZ.size}`}>
        <circle cx={BZ.cx} cy={BZ.cy} r={ro} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <circle cx={BZ.cx} cy={BZ.cy} r={ri} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".6" />
        <BzArcs ro={ro} ri={ri} blocks={DAYBLOCKS.Tue} futureOnly />
        <BzDot r={ro} label={"now · " + fmtH(NOW_H)} />
      </svg>
      <div className="clk-center" style={{ width: 340 }}>
        <span className="clk-tag" style={{ fontSize: 10.5, padding: "4px 11px" }}>work · held</span>
        <div className="bz-title" style={{ fontSize: 31, margin: "11px 0 8px" }}>Finish the Q3 deck.</div>
        <div className="bz-meta" style={{ fontSize: 11.5 }}>40:00 left · <b>5 mews</b></div>
        <div className="bz-next">
          {upcoming.map((b, i) => (
            <div key={i} className="nx">
              <i>{fmtH(b[0])}</i>
              <span className="dotw" style={{ background: b[3] === "work" ? "var(--ice)" : "var(--teal)", opacity: b[3] === "rest" ? .55 : 1 }}></span>
              <span style={{ color: i === 0 ? "var(--ink)" : "var(--muted)", fontWeight: i === 0 ? 600 : 500 }}>{b[2]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* B3 · SPOTLIGHT — the countdown is the hero; beyond this block, everything waits */
function BezelB3() {
  const ro = 268, ri = 226;
  const blockEnd = 11.5;
  return (
    <div style={{ position: "relative", width: BZ.size, height: BZ.size }}>
      <svg width={BZ.size} height={BZ.size} viewBox={`0 0 ${BZ.size} ${BZ.size}`}>
        <circle cx={BZ.cx} cy={BZ.cy} r={ro} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <circle cx={BZ.cx} cy={BZ.cy} r={ri} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".6" />
        {/* the spotlight wedge: now → block end */}
        {(() => {
          const d0 = 0, d1 = bzDeg(blockEnd);
          const [xo0, yo0] = rPolar(BZ.cx, BZ.cy, ro + 14, d0);
          const [xo1, yo1] = rPolar(BZ.cx, BZ.cy, ro + 14, d1);
          return (
            <path d={`M ${BZ.cx} ${BZ.cy} L ${xo0} ${yo0} A ${ro + 14} ${ro + 14} 0 0 1 ${xo1} ${yo1} Z`}
              fill="var(--ice)" opacity=".07" />
          );
        })()}
        <BzArcs ro={ro} ri={ri} blocks={DAYBLOCKS.Tue} futureOnly dimAfter={blockEnd} />
        <BzDot r={ro} label={"now · " + fmtH(NOW_H)} />
      </svg>
      <div className="clk-center" style={{ width: 340 }}>
        <div className="bz-count">40<small>min</small></div>
        <div className="bz-title" style={{ fontSize: 25, margin: "12px 0 8px" }}>Finish the Q3 deck.</div>
        <span className="clk-tag" style={{ fontSize: 9.5 }}>work · held until 11:30</span>
        <div className="bz-meta" style={{ fontSize: 11, marginTop: 10 }}><b>5 mews</b> · after this: standup, then lunch</div>
      </div>
    </div>
  );
}

function SurfaceBezel({ variant = 1 }) {
  const Comp = variant === 1 ? BezelB1 : variant === 2 ? BezelB2 : BezelB3;
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

Object.assign(window, { BzStyles, SurfaceBezel });
