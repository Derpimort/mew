// mew-v16-noir.jsx — THE CONVERGENCE. F1 Instrument, finalized as "Noir":
// pitch black (and pure white) with only Pixie's own colors — gold fur for
// work & attention, cream chest for life. Minimal at rest; labels, marks and
// telemetry animate in on hover; blocks expand with detail on hover/click.

const NxStyles = () => (
  <style>{`
  .nx{
    --bg:#050505; --panel:#0b0a09; --panel2:#121110; --glass:rgba(16,15,13,.88);
    --ink:#f4efe6; --muted:#9b9183; --faint:#5f574b; --line:#221f19; --line2:#161410;
    --ice:#e9b96b; --ice-soft:rgba(233,185,107,.13); --ice-bd:rgba(233,185,107,.45);
    --teal:#d8c9a6; --teal-soft:rgba(216,201,166,.11); --teal-bd:rgba(216,201,166,.42);
    --gold:#e9b96b; --gold-soft:rgba(233,185,107,.15);
    --glow:0 0 14px rgba(233,185,107,.45); --glowc:rgba(233,185,107,.8);
  }
  .nx.nx--light{
    --bg:#ffffff; --panel:#fbfaf7; --panel2:#f4f1ea; --glass:rgba(255,255,255,.92);
    --ink:#171208; --muted:#6e6353; --faint:#a89d89; --line:#e8e3d7; --line2:#f2efe7;
    --ice:#a4761f; --ice-soft:rgba(164,118,31,.1); --ice-bd:rgba(164,118,31,.42);
    --teal:#7e6f4d; --teal-soft:rgba(126,111,77,.1); --teal-bd:rgba(126,111,77,.4);
    --gold:#a4761f; --gold-soft:rgba(164,118,31,.12);
    --glow:0 0 12px rgba(164,118,31,.35); --glowc:rgba(164,118,31,.5);
  }
  .nx-fade{ opacity:0; transition:opacity .5s ease; }
  .nx-stage:hover .nx-fade, .nx-stage.reveal .nx-fade{ opacity:1; }
  .nx-arc{ transition:stroke-width .25s ease, opacity .25s ease; cursor:pointer; }
  .nx-wedge{ animation:nxWedge 6.5s ease-in-out infinite; }
  @keyframes nxWedge{ 0%,100%{ opacity:.06; } 50%{ opacity:.11; } }
  .nx-card{ position:absolute; width:230px; background:var(--glass); border:1px solid var(--ice-bd); border-radius:16px; padding:14px 16px; box-shadow:0 24px 60px -24px rgba(0,0,0,.7); z-index:20; }
  .nx--light .nx-card{ box-shadow:0 24px 60px -28px rgba(60,45,15,.35); }
  .nx-card .ct{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.01em; }
  .nx-card .cm{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); margin-top:5px; }
  .nx-card .ctag{ display:inline-block; font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ice); background:var(--ice-soft); border:1px solid var(--ice-bd); border-radius:5px; padding:2px 7px; margin-top:9px; }
  .nx-card .ctag.life{ color:var(--teal); background:var(--teal-soft); border-color:var(--teal-bd); }
  .nx-card .cacts{ display:flex; gap:6px; margin-top:11px; }
  .nx-card .ca{ font-size:11px; font-weight:700; padding:5px 11px; border-radius:8px; cursor:pointer; font-family:'Hanken Grotesk',sans-serif; white-space:nowrap; }
  .nx-card .ca.pri{ background:var(--ice); color:var(--bg); }
  .nx-card .ca.sec{ border:1px solid var(--line); color:var(--ink); background:var(--panel2); }
  .nx-count{ font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-0.035em; line-height:.95; }
  .nx-task{ font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:-0.018em; }
  .nx-mono{ font-family:'JetBrains Mono',monospace; }
  .nx-mini-lbl{ text-align:center; margin-top:10px; }
  .nx-mini-lbl .d{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:14px; }
  .nx-mini-lbl .h{ font-family:'JetBrains Mono',monospace; font-size:9.5px; color:var(--muted); margin-top:2px; }
  @media (prefers-reduced-motion: reduce){ .nx-wedge{ animation:none; } .nx-fade{ transition:none; } }
  `}</style>
);

const NXG = { cx: 310, cy: 310, ro: 268, ri: 226, w: 824, h: 620, ox: 110 };

function NxArcSet({ hover, onHover, expandIdx, g = NXG }) {
  const vis = DAYBLOCKS.Tue.map((b, i) => [b, i]).filter(([b]) => b[1] > NOW_H && b[0] < NOW_H + 11.2);
  return (
    <g>
      {vis.map(([b, i]) => {
        const [s, e, , tag, f = {}] = b;
        const work = tag === "work";
        const r = work ? g.ro : g.ri;
        const big = f.now || expandIdx === i;
        return (
          <path key={i} className="nx-arc" d={rArc(g.cx, g.cy, r, spDeg(Math.max(s, NOW_H)), spDeg(e))} fill="none"
            stroke={work ? "var(--ice)" : "var(--teal)"}
            strokeWidth={f.now ? 22 : big ? 15 : 8} strokeLinecap="round"
            strokeDasharray={tag === "rest" ? "2 6" : "none"}
            style={f.now ? { filter: "drop-shadow(0 0 10px var(--glowc))" } : {}}
            onMouseEnter={() => onHover && onHover(i)} onMouseLeave={() => onHover && onHover(null)} />
        );
      })}
    </g>
  );
}

function NxFocus({ light, reveal, expand = null }) {
  const [hb, setHb] = React.useState(null);
  const sel = hb != null ? hb : expand;
  const selB = sel != null ? DAYBLOCKS.Tue[sel] : null;
  const g = NXG;
  const future = DAYBLOCKS.Tue.map((b, i) => [b, i]).filter(([b]) => b[0] > NOW_H);

  let card = null;
  if (selB) {
    const [s, e, title, tag, f = {}] = selB;
    const mid = (Math.max(s, NOW_H) + e) / 2;
    const r = (tag === "work" ? g.ro : g.ri) + 26;
    const [sx, sy] = rPolar(g.cx, g.cy, r, spDeg(mid));
    const left = sx + g.ox, top = sy;
    const onRight = sx > g.cx;
    card = (
      <div className="nx-card" style={{ left, top, transform: onRight ? "translate(10px,-50%)" : "translate(calc(-100% - 10px),-50%)" }}>
        <div className="ct">{title}</div>
        <div className="cm">{fmtH(s)} – {fmtH(e)} · {((e - s) * 60) | 0} min{f.prot ? " · held" : ""}{f.done ? " · done" : ""}</div>
        <span className={"ctag" + (tag === "work" ? "" : " life")}>{tag === "work" ? "work" : tag === "rest" ? "rest · earned" : "life"}</span>
        <div className="cacts">
          <span className="ca pri">{f.now ? "Done — a mew" : "Start now"}</span>
          <span className="ca sec">Move</span>
          {f.prot ? <span className="ca sec">Release</span> : <span className="ca sec">Hold</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={"nx-stage" + (reveal ? " reveal" : "")} style={{ position: "relative", width: g.w, height: g.h }}>
      <svg width={g.w} height={g.h} viewBox={`-${g.ox} 0 ${g.w} ${g.h}`}>
        <circle cx={g.cx} cy={g.cy} r={g.ro} fill="none" stroke="var(--line)" strokeWidth="1.2" />
        <circle cx={g.cx} cy={g.cy} r={g.ri} fill="none" stroke="var(--line)" strokeWidth="1.2" opacity=".7" />
        {(() => { const [x0, y0] = rPolar(g.cx, g.cy, g.ro + 12, 0); const [x1, y1] = rPolar(g.cx, g.cy, g.ro + 12, spDeg(BLOCK_END)); return (
          <path className="nx-wedge" d={`M ${g.cx} ${g.cy} L ${x0} ${y0} A ${g.ro + 12} ${g.ro + 12} 0 0 1 ${x1} ${y1} Z`} fill="var(--ice)" />
        ); })()}
        {/* hour marks — revealed on approach */}
        <g className="nx-fade">
          {[3, 6, 9].map((dh) => {
            const h = NOW_H + dh;
            const [x, y] = rPolar(g.cx, g.cy, g.ro + 26, spDeg(h));
            return <text key={dh} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="nx-mono" style={{ fill: "var(--faint)", fontSize: 10 }}>+{dh}h</text>;
          })}
        </g>
        <NxArcSet onHover={setHb} expandIdx={sel} />
        {/* future labels — revealed on approach */}
        <g className="nx-fade">
          {future.map(([b, i]) => {
            const [s, e, title, tag] = b;
            const short = title.length > 12 ? title.slice(0, 10) + "\u2026" : title;
            const mid = (Math.max(s, NOW_H) + e) / 2;
            const stag = 38 + ((i % 2) * 20);
            const [lx, ly] = rPolar(g.cx, g.cy, g.ro + stag, spDeg(mid));
            const anchor = lx > g.cx + 14 ? "start" : lx < g.cx - 14 ? "end" : "middle";
            return (
              <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="central"
                style={{ fill: tag === "work" ? "var(--ice)" : "var(--teal)", fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                onMouseEnter={() => setHb(i)} onMouseLeave={() => setHb(null)}>
                {short} <tspan style={{ fill: "var(--muted)", fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5 }}>{fmtH(s)}</tspan>
              </text>
            );
          })}
        </g>
        {(() => { const [x, y] = rPolar(g.cx, g.cy, g.ro, 0); return (
          <g>
            <circle cx={x} cy={y} r="7" fill="var(--ice)" style={{ filter: "drop-shadow(0 0 12px var(--glowc))" }} />
            <text x={x} y={y - 20} textAnchor="middle" className="nx-mono" style={{ fill: "var(--ice)", fontSize: 11.5, fontWeight: 700 }}>now · {fmtH(NOW_H)}</text>
          </g>
        ); })()}
      </svg>

      <div className="clk-center" style={{ width: 330 }}>
        <div className="nx-count" style={{ fontSize: 92 }}>40:00</div>
        <div className="nx-mono" style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", margin: "8px 0 12px", fontWeight: 600 }}>remaining · held until 11:30</div>
        <div className="nx-task" style={{ fontSize: 27 }}>Finish the Q3 deck.</div>
        <div className="nx-fade nx-mono" style={{ marginTop: 12, fontSize: 11.5 }}>
          <span style={{ color: "var(--gold)", fontWeight: 700 }}>★ 5 mews</span><span style={{ color: "var(--muted)" }}> · guard on · 2 switches</span>
        </div>
      </div>
      {card}
    </div>
  );
}

/* Week — seven dials, today burning */
function NxMini({ dayKey, size, today }) {
  const c = size / 2, ro = c - 7, ri = c - 16;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={ro} fill="none" stroke="var(--line)" strokeWidth="1" />
      {DAYBLOCKS[dayKey].map((b, i) => {
        const [s, e, , tag, f = {}] = b;
        const work = tag === "work";
        return (
          <path key={i} d={rArc(c, c, work ? ro : ri, ((s - 8) / 12) * 360, ((e - 8) / 12) * 360)} fill="none"
            stroke={work ? "var(--ice)" : "var(--teal)"} strokeWidth={today && f.now ? 7 : 4} strokeLinecap="round"
            strokeDasharray={tag === "rest" ? "2 5" : "none"} opacity={f.done ? .35 : 1}
            style={today && f.now ? { filter: "drop-shadow(0 0 7px var(--glowc))" } : {}} />
        );
      })}
      {today && (() => { const [x, y] = rPolar(c, c, ro, ((NOW_H - 8) / 12) * 360); return <circle cx={x} cy={y} r="4" fill="var(--ice)" style={{ filter: "drop-shadow(0 0 8px var(--glowc))" }} />; })()}
    </svg>
  );
}

function NxWeek() {
  const totals = { Mon: "7.0h", Tue: "6.5h", Wed: "8.5h", Thu: "6.0h", Fri: "3.5h", Sat: "2.5h", Sun: "2.0h" };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 26 }}>
        {DAY_META.map((m) => (
          <div key={m.d} style={{ opacity: m.past ? .45 : 1 }}>
            <div style={{ position: "relative" }}>
              <NxMini dayKey={m.d} size={m.today ? 168 : 104} today={m.today} />
              {m.heavy && <span className="nx-mono" style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: "var(--gold)", fontWeight: 700, whiteSpace: "nowrap" }}>heavy · 8h</span>}
            </div>
            <div className="nx-mini-lbl">
              <div className="d" style={{ color: m.today ? "var(--ice)" : "var(--ink)", fontSize: m.today ? 16 : 14 }}>{m.d} {m.n}</div>
              <div className="h">{totals[m.d]}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="nx-mono" style={{ fontSize: 11, color: "var(--muted)" }}>
        32h planned · rest kept <span style={{ color: "var(--teal)", fontWeight: 700 }}>4/5</span> · wednesday wants a kinder shape — <span style={{ color: "var(--gold)", fontWeight: 700 }}>nudge in chat</span>
      </div>
    </div>
  );
}

function SurfaceNx({ view = "focus", light, reveal, expand }) {
  return (
    <div className={"stl nx" + (light ? " nx--light" : "")} style={{ width: 1280, height: 840, display: "grid", gridTemplateColumns: "1fr 452px", background: "var(--bg)" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 20, left: 28, zIndex: 10 }}><span className="disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "var(--ink)" }}>MEW</span></div>
        <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span className="agent">watching · drift armed · quiet 18:30</span>
        </div>
        <div style={{ position: "absolute", top: 20, right: 24, zIndex: 10 }}>
          <span className="seg2">
            <span className={view === "focus" ? "on" : ""}>Focus</span>
            <span className={view === "week" ? "on" : ""}>Week</span>
          </span>
        </div>
        {view === "focus" ? <NxFocus light={light} reveal={reveal} expand={expand} /> : <NxWeek />}
      </div>
      <DenSession />
    </div>
  );
}

Object.assign(window, { NxStyles, SurfaceNx });
