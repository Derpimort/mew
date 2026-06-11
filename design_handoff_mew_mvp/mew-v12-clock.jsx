// mew-v12-clock.jsx — FOCUS VIEW: the day as a 24h dial in the center.
// Three iterations: K1 The Dial · K2 Orbit (labels around) · K3 Twin Rings.
// Steel system; right column = Pixie's den + session (v11).

const ClkStyles = () => (
  <style>{`
  .clk-center{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); text-align:center; width:300px; }
  .clk-tag{ display:inline-block; font-family:'JetBrains Mono',monospace; font-size:9.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--ice); background:var(--ice-soft); border:1px solid var(--ice-bd); border-radius:6px; padding:3px 9px; }
  .clk-title{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:27px; line-height:1.12; letter-spacing:-0.015em; margin:10px 0 8px; }
  .clk-meta{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); }
  .clk-meta b{ color:var(--gold); font-weight:600; }
  .clk-sub{ font-size:11.5px; color:var(--faint); margin-top:6px; }
  .clk-lbl{ font-family:'JetBrains Mono',monospace; font-size:9px; fill:var(--faint); }
  .clk-lbl.maj{ font-size:10px; fill:var(--muted); font-weight:600; }
  .clk-task{ font-family:'Hanken Grotesk',sans-serif; font-size:10.5px; font-weight:600; }
  .clk-task.done{ text-decoration:line-through; opacity:.45; }
  .clk-task.t-work{ fill:var(--ice); }
  .clk-task.t-private{ fill:var(--teal); }
  .clk-task.t-rest{ fill:var(--teal); opacity:.7; }
  .clk-task .tm{ font-family:'JetBrains Mono',monospace; font-size:8.5px; opacity:.65; }
  `}</style>
);

const clkPolar = (cx, cy, r, h) => {
  const a = ((h / 24) * 360 - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const clkArc = (cx, cy, r, h0, h1) => {
  const [x0, y0] = clkPolar(cx, cy, r, h0);
  const [x1, y1] = clkPolar(cx, cy, r, h1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${(h1 - h0) > 12 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

function ClkTicks({ cx, cy, r }) {
  return (
    <g>
      {Array.from({ length: 24 }, (_, h) => {
        const maj = h % 6 === 0;
        const [x0, y0] = clkPolar(cx, cy, r - (maj ? 9 : 5), h);
        const [x1, y1] = clkPolar(cx, cy, r, h);
        return <line key={h} x1={x0} y1={y0} x2={x1} y2={y1} stroke={maj ? "var(--muted)" : "var(--line)"} strokeWidth={maj ? 1.6 : 1} />;
      })}
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = clkPolar(cx, cy, r + 16, h);
        return <text key={h} x={x} y={y} className="clk-lbl maj" textAnchor="middle" dominantBaseline="central">{String(h).padStart(2, "0")}</text>;
      })}
    </g>
  );
}

function ClkNight({ cx, cy, r, w }) {
  return <path d={clkArc(cx, cy, r, 22, 24)} stroke="var(--line2)" strokeWidth={w} fill="none" opacity=".5" strokeLinecap="round" />
}

function ClkBlocks({ cx, cy, r, w, withNow = true }) {
  return (
    <g>
      <path d={clkArc(cx, cy, r, 6, 22)} stroke="var(--line2)" strokeWidth={1.2} fill="none" />
      <ClkNight cx={cx} cy={cy} r={r} w={1.2} />
      {DAYBLOCKS.Tue.map((b, i) => {
        const [s, e, , tag, f = {}] = b;
        const col = tag === "work" ? "var(--ice)" : "var(--teal)";
        return (
          <path key={i} d={clkArc(cx, cy, r, s, e)} fill="none"
            stroke={col} strokeWidth={f.now ? w + 4 : w} strokeLinecap="round"
            strokeDasharray={tag === "rest" ? "3 5" : "none"}
            opacity={f.done ? .3 : f.now ? 1 : .62}
            style={f.now ? { filter: "drop-shadow(0 0 8px rgba(130,180,232,.8))" } : {}} />
        );
      })}
      {withNow && (() => {
        const [x, y] = clkPolar(cx, cy, r, NOW_H);
        return (
          <g>
            <circle cx={x} cy={y} r="6" fill="#dcebfa" style={{ filter: "drop-shadow(0 0 10px rgba(130,180,232,.95))" }} />
            <text x={x} y={y - 14} className="clk-lbl maj" textAnchor="middle" fill="var(--ice)" style={{ fill: "var(--ice)" }}>{fmtH(NOW_H)}</text>
          </g>
        );
      })()}
    </g>
  );
}

function ClkCenter({ sub }) {
  return (
    <div className="clk-center">
      <span className="clk-tag">work · held</span>
      <div className="clk-title">Finish the Q3 deck.</div>
      <div className="clk-meta">40:00 left · until 11:30 · <b>5 mews</b></div>
      {sub && <div className="clk-sub">{sub}</div>}
    </div>
  );
}

/* K1 · THE DIAL — pure instrument */
function ClockK1() {
  const cx = 280, cy = 280;
  return (
    <div style={{ position: "relative", width: 560, height: 560 }}>
      <svg width="560" height="560" viewBox="0 0 560 560">
        <circle cx={cx} cy={cy} r="252" fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".6" />
        <ClkTicks cx={cx} cy={cy} r={252} />
        <ClkBlocks cx={cx} cy={cy} r={222} w={16} />
      </svg>
      <ClkCenter sub="evening is yours — nothing after 19:00" />
    </div>
  );
}

/* K2 · ORBIT — tasks named around the ring */
function ClockK2() {
  const cx = 280, cy = 280, r = 196;
  return (
    <div style={{ position: "relative", width: 560, height: 560 }}>
      <svg width="560" height="560" viewBox="0 0 560 560">
        <ClkBlocks cx={cx} cy={cy} r={r} w={13} />
        {DAYBLOCKS.Tue.map((b, i) => {
          const [s, e, title, tag, f = {}] = b;
          const mid = (s + e) / 2;
          const stag = 34 + (i % 2) * 20;
          const [lx, ly] = clkPolar(cx, cy, r + stag, mid);
          const [tx0, ty0] = clkPolar(cx, cy, r + 12, mid);
          const [tx1, ty1] = clkPolar(cx, cy, r + stag - 10, mid);
          const anchor = lx > cx + 14 ? "start" : lx < cx - 14 ? "end" : "middle";
          return (
            <g key={i}>
              <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} stroke="var(--line)" strokeWidth="1" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="central"
                className={"clk-task t-" + tag + (f.done ? " done" : "")}
                style={f.now ? { fontWeight: 700 } : {}}>
                {f.done ? "✓ " : ""}{title}{f.now ? " ·" : ""} <tspan className="tm">{fmtH(s)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <ClkCenter />
    </div>
  );
}

/* K3 · TWIN RINGS — work outside, life inside */
function ClockK3() {
  const cx = 280, cy = 280;
  const ro = 234, ri = 198;
  return (
    <div style={{ position: "relative", width: 560, height: 560 }}>
      <svg width="560" height="560" viewBox="0 0 560 560">
        <ClkTicks cx={cx} cy={cy} r={262} />
        {/* base rings */}
        <circle cx={cx} cy={cy} r={ro} fill="none" stroke="var(--line2)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={ri} fill="none" stroke="var(--line2)" strokeWidth="1" opacity=".7" />
        {DAYBLOCKS.Tue.map((b, i) => {
          const [s, e, , tag, f = {}] = b;
          const work = tag === "work";
          const r = work ? ro : ri;
          return (
            <path key={i} d={clkArc(cx, cy, r, s, e)} fill="none"
              stroke={work ? "var(--ice)" : "var(--teal)"} strokeWidth={f.now ? 17 : 13} strokeLinecap="round"
              strokeDasharray={tag === "rest" ? "3 5" : "none"}
              opacity={f.done ? .3 : f.now ? 1 : .65}
              style={f.now ? { filter: "drop-shadow(0 0 8px rgba(130,180,232,.8))" } : {}} />
          );
        })}
        {/* now needle across both rings */}
        {(() => {
          const [x0, y0] = clkPolar(cx, cy, ri - 22, NOW_H);
          const [x1, y1] = clkPolar(cx, cy, ro + 14, NOW_H);
          const [xd, yd] = clkPolar(cx, cy, ro, NOW_H);
          return (
            <g>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ice)" strokeWidth="1.6" opacity=".8" />
              <circle cx={xd} cy={yd} r="6" fill="#dcebfa" style={{ filter: "drop-shadow(0 0 10px rgba(130,180,232,.95))" }} />
            </g>
          );
        })()}
        <text {...(() => { const [x, y] = clkPolar(cx, cy, ro + 30, NOW_H); return { x, y }; })()} className="clk-lbl maj" textAnchor="middle" style={{ fill: "var(--ice)" }}>{fmtH(NOW_H)}</text>
      </svg>
      <ClkCenter sub="outer ring · work — inner ring · life" />
    </div>
  );
}

/* den + session column (v11), extracted */
function DenSession() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel)", borderLeft: "1px solid var(--line2)" }}>
      <div className="den-zone" style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div className="den-big" style={{ width: 132, height: 132 }}>
          <img src="pixie-poly-face.svg" alt="Pixie" style={{ width: 180, marginLeft: -24, marginTop: -30 }} />
        </div>
        <div className="den-meta">
          <div className="nm">Pixie</div>
          <div className="st">healthy · mewing away</div>
          <div className="ds">A pace you can keep. Thursday is held for the deck.</div>
          <div className="den-pace"><div className="pl">pace · sustainable</div><div className="pb"><span></span></div></div>
        </div>
      </div>
      <div className="trm-bar"><span className="dots"><span></span><span></span><span></span></span><span>mew session — tty1</span><span style={{ marginLeft: "auto" }}><kbd>⌘K</kbd></span></div>
      <div style={{ flex: 1, padding: "14px 20px", minHeight: 0, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", justifyContent: "flex-end" }}>
        <div className="log" style={{ fontSize: 11.5 }}>
          <div style={{ color: "var(--faint)" }}># tuesday · plan committed 08:45 · 6 blocks</div>
          <div style={{ marginTop: 9 }}><span className="p-you prompt">you ❯</span> <b>block thursday morning for the deck</b></div>
          <div style={{ marginTop: 3 }}><span className="p-mew prompt">mew ❯</span> <span className="ok">✓</span> thu 09:00–12:00 <b>held</b></div>
          <div style={{ marginTop: 10 }}><span className="p-mew prompt">mew ❯</span> <span className="mw">★</span> <b>mew #5</b> — standup notes · 5 today</div>
        </div>
        <div className="tui-nudge">
          <div className="h">▸ nudge/drift — 09:40</div>
          still on the deck, or should i move it? off-task ~12 min.<br />
          <span className="tui-btn pri">still on it</span><span className="tui-btn">move it</span><span className="tui-btn">guard block</span>
        </div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        <div className="prompt" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5 }}>
          <span className="p-you">you</span> <span className="p-arr">❯</span><span className="blink"></span>
        </div>
      </div>
    </div>
  );
}

function SurfaceClock({ variant = 1 }) {
  const Clock = variant === 1 ? ClockK1 : variant === 2 ? ClockK2 : ClockK3;
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
        <Clock />
        <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>ice · work — teal · life — dashed · rest — dim · done</span>
        </div>
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { ClkStyles, SurfaceClock, DenSession });
