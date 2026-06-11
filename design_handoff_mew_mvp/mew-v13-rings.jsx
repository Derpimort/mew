// mew-v13-rings.jsx — TWIN RINGS, 12h. Three smart answers to the wrap problem:
// R1 True Clock (real 12h face + hands, arcs wrap mod 12)
// R2 Bezel (rolling next-12h window, now pinned at top — nothing ever wraps)
// R3 Day Fan (the 12 waking hours as a 240° fan with a quiet night gap)
// Work = outer ring · life = inner ring, always.

const RngStyles = () => (
  <style>{`
  .rng-hand{ stroke:var(--muted); stroke-linecap:round; }
  .rng-ampm{ display:inline-block; font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; letter-spacing:.12em; color:var(--gold); border:1px solid rgba(227,182,108,.4); border-radius:5px; padding:1px 7px; margin-left:7px; vertical-align:2px; }
  `}</style>
);

const rPolar = (cx, cy, r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const rArc = (cx, cy, r, d0, d1) => {
  if (d1 < d0) d1 += 360;
  const [x0, y0] = rPolar(cx, cy, r, d0);
  const [x1, y1] = rPolar(cx, cy, r, d1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${(d1 - d0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

function TwinArcs({ cx, cy, ro, ri, degOf, blocks }) {
  return (
    <g>
      {blocks.map((b, i) => {
        const [s, e, , tag, f = {}] = b;
        const work = tag === "work";
        const r = work ? ro : ri;
        return (
          <path key={i} d={rArc(cx, cy, r, degOf(s), degOf(e))} fill="none"
            stroke={work ? "var(--ice)" : "var(--teal)"} strokeWidth={f.now ? 17 : 13} strokeLinecap="round"
            strokeDasharray={tag === "rest" ? "3 5" : "none"}
            opacity={f.done ? .28 : f.now ? 1 : .65}
            style={f.now ? { filter: "drop-shadow(0 0 8px rgba(130,180,232,.8))" } : {}} />
        );
      })}
    </g>
  );
}

function NowNeedle({ cx, cy, ro, ri, deg, label }) {
  const [x0, y0] = rPolar(cx, cy, ri - 22, deg);
  const [x1, y1] = rPolar(cx, cy, ro + 14, deg);
  const [xd, yd] = rPolar(cx, cy, ro, deg);
  const [lx, ly] = rPolar(cx, cy, ro + 30, deg);
  return (
    <g>
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ice)" strokeWidth="1.6" opacity=".8" />
      <circle cx={xd} cy={yd} r="6" fill="#dcebfa" style={{ filter: "drop-shadow(0 0 10px rgba(130,180,232,.95))" }} />
      {label && <text x={lx} y={ly} className="clk-lbl maj" textAnchor="middle" style={{ fill: "var(--ice)" }}>{label}</text>}
    </g>
  );
}

/* R1 · TRUE CLOCK — a real 12h face. Arcs wrap mod 12; hands tell the time. */
function RingR1() {
  const cx = 280, cy = 280, ro = 226, ri = 190;
  const degOf = (h) => ((h % 12) / 12) * 360;
  const hourDeg = degOf(NOW_H);
  const minDeg = (NOW_H % 1) * 360;
  return (
    <div style={{ position: "relative", width: 560, height: 560 }}>
      <svg width="560" height="560" viewBox="0 0 560 560">
        {Array.from({ length: 12 }, (_, i) => {
          const [x0, y0] = rPolar(cx, cy, 252, i * 30);
          const [x1, y1] = rPolar(cx, cy, 244, i * 30);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={i % 3 === 0 ? "var(--muted)" : "var(--line)"} strokeWidth={i % 3 === 0 ? 1.6 : 1} />;
        })}
        {[12, 3, 6, 9].map((n) => {
          const [x, y] = rPolar(cx, cy, 264, (n % 12) * 30);
          return <text key={n} x={x} y={y} className="clk-lbl maj" textAnchor="middle" dominantBaseline="central">{n}</text>;
        })}
        <circle cx={cx} cy={cy} r={ro} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={ri} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".7" />
        <TwinArcs cx={cx} cy={cy} ro={ro} ri={ri} degOf={degOf} blocks={DAYBLOCKS.Tue} />
        {/* hands — under the center card, over rings */}
        <line {...(() => { const [x, y] = rPolar(cx, cy, 92, hourDeg); return { x1: cx, y1: cy, x2: x, y2: y }; })()} className="rng-hand" strokeWidth="3.5" opacity=".9" />
        <line {...(() => { const [x, y] = rPolar(cx, cy, 132, minDeg); return { x1: cx, y1: cy, x2: x, y2: y }; })()} className="rng-hand" strokeWidth="2" opacity=".55" />
        <circle cx={cx} cy={cy} r="4" fill="var(--muted)" />
        <NowNeedle cx={cx} cy={cy} ro={ro} ri={ri} deg={hourDeg} label={fmtH(NOW_H)} />
      </svg>
      <div className="clk-center" style={{ transform: "translate(-50%,-50%) translateY(78px)", width: 280 }}>
        <span className="clk-tag">work · held</span><span className="rng-ampm">AM</span>
        <div className="clk-title" style={{ fontSize: 23 }}>Finish the Q3 deck.</div>
        <div className="clk-meta">40:00 left · <b>5 mews</b></div>
      </div>
    </div>
  );
}

/* R2 · BEZEL — the next 12 hours, now pinned at top. Nothing wraps, ever. */
function RingR2() {
  const cx = 280, cy = 280, ro = 226, ri = 190;
  const degOf = (h) => ((h - NOW_H) / 12) * 360;
  const visible = DAYBLOCKS.Tue.filter(([s, e]) => e > NOW_H - 0.4 && s < NOW_H + 11.4);
  const hours = [];
  for (let h = Math.ceil(NOW_H); h <= NOW_H + 11; h += 2) hours.push(h);
  return (
    <div style={{ position: "relative", width: 560, height: 560 }}>
      <svg width="560" height="560" viewBox="0 0 560 560">
        <circle cx={cx} cy={cy} r={ro} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={ri} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".7" />
        {hours.map((h) => {
          const [x, y] = rPolar(cx, cy, 258, degOf(h));
          const [x0, y0] = rPolar(cx, cy, 246, degOf(h));
          const [x1, y1] = rPolar(cx, cy, 240, degOf(h));
          return (
            <g key={h}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--line)" strokeWidth="1.2" />
              <text x={x} y={y} className="clk-lbl" textAnchor="middle" dominantBaseline="central">{h}:00</text>
            </g>
          );
        })}
        <TwinArcs cx={cx} cy={cy} ro={ro} ri={ri} degOf={degOf} blocks={visible} />
        {/* now — fixed at top */}
        <NowNeedle cx={cx} cy={cy} ro={ro} ri={ri} deg={0} label={"now · " + fmtH(NOW_H)} />
      </svg>
      <ClkCenter sub="the dial turns — what's ahead is always at the top" />
    </div>
  );
}

/* R3 · DAY FAN — the 12 waking hours as a 240° fan; night is the quiet gap */
function RingR3() {
  const cx = 280, cy = 292, ro = 226, ri = 190;
  const degOf = (h) => -120 + ((h - 8) / 12) * 240;
  return (
    <div style={{ position: "relative", width: 560, height: 560 }}>
      <svg width="560" height="560" viewBox="0 0 560 560">
        <path d={rArc(cx, cy, ro, -120, 120)} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <path d={rArc(cx, cy, ri, -120, 120)} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".7" />
        {[8, 10, 12, 14, 16, 18, 20].map((h) => {
          const [x, y] = rPolar(cx, cy, 256, degOf(h));
          const [x0, y0] = rPolar(cx, cy, 244, degOf(h));
          const [x1, y1] = rPolar(cx, cy, 238, degOf(h));
          return (
            <g key={h}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--line)" strokeWidth="1.2" />
              <text x={x} y={y} className="clk-lbl" textAnchor="middle" dominantBaseline="central">{h}</text>
            </g>
          );
        })}
        {/* night gap label */}
        <text x={cx} y={cy + ro + 22} className="clk-lbl" textAnchor="middle" opacity=".8">night · yours</text>
        <TwinArcs cx={cx} cy={cy} ro={ro} ri={ri} degOf={degOf} blocks={DAYBLOCKS.Tue} />
        <NowNeedle cx={cx} cy={cy} ro={ro} ri={ri} deg={degOf(NOW_H)} label={fmtH(NOW_H)} />
      </svg>
      <ClkCenter sub="8:00 → 20:00 · the gap below is the night" />
    </div>
  );
}

function SurfaceRing({ variant = 1 }) {
  const Comp = variant === 1 ? RingR1 : variant === 2 ? RingR2 : RingR3;
  return (
    <div className="stl" style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="agent">tuesday 9 jun · focus</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24 }}>
          <span className="seg2"><span className="on">Focus</span><span>Week</span></span>
        </div>
        <Comp />
        <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>outer · work — inner · life — dashed · rest — dim · done</span>
        </div>
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { RngStyles, SurfaceRing });
