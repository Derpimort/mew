// mew-v8-core.jsx — the steel system. Dark steel-blue default, steel light.
// Cool structure (ice = attention, teal = life), warmth reserved for what's
// alive (Pixie, mews = gold). Shared: tokens, week/day beam with selector,
// command composer, agent status, nudge card, vitals chips.

const StlStyles = () => (
  <style>{`
  .stl{
    --bg:#0e141c; --panel:#141c26; --panel2:#192330; --glass:rgba(22,31,43,.82);
    --ink:#e7edf5; --muted:#8d9aab; --faint:#566879; --line:#233140; --line2:#1b2633;
    --ice:#82b4e8; --ice-soft:rgba(130,180,232,.15); --ice-bd:rgba(130,180,232,.45);
    --teal:#76b596; --teal-soft:rgba(118,181,150,.13); --teal-bd:rgba(118,181,150,.4);
    --gold:#e3b66c; --gold-soft:rgba(227,182,108,.16);
    --glow: 0 0 14px rgba(130,180,232,.55);
    font-family:'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif;
    background:var(--bg); color:var(--ink); position:relative; overflow:hidden;
    box-sizing:border-box; -webkit-font-smoothing:antialiased;
  }
  .stl--light{
    --bg:#e7ebf0; --panel:#f1f4f8; --panel2:#fbfcfe; --glass:rgba(249,251,253,.85);
    --ink:#18212c; --muted:#5b6a7c; --faint:#93a2b2; --line:#d2dae3; --line2:#dde3ea;
    --ice:#3d77b8; --ice-soft:rgba(61,119,184,.12); --ice-bd:rgba(61,119,184,.4);
    --teal:#3e8c66; --teal-soft:rgba(62,140,102,.12); --teal-bd:rgba(62,140,102,.38);
    --gold:#b8862f; --gold-soft:rgba(184,134,47,.14);
    --glow: 0 0 12px rgba(61,119,184,.35);
  }
  .stl *{ box-sizing:border-box; }
  .stl .disp{ font-family:'Space Grotesk', sans-serif; letter-spacing:-0.02em; }
  .stl .mono{ font-family:'JetBrains Mono', ui-monospace, monospace; }
  .stl .slabel{ font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); font-family:'JetBrains Mono',monospace; }

  /* segmented day/week selector */
  .seg2{ display:inline-flex; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:3px; gap:2px; }
  .seg2 span{ font-size:12px; font-weight:600; padding:4px 14px; border-radius:7px; color:var(--muted); cursor:pointer; user-select:none; white-space:nowrap; }
  .seg2 span.on{ background:var(--ice-soft); color:var(--ice); box-shadow:inset 0 0 0 1px var(--ice-bd); }

  /* beam tracks */
  .bm-track{ position:relative; border-radius:10px; background:var(--panel); border:1px solid var(--line2); }
  .bm-row{ display:grid; grid-template-columns:40px 1fr; gap:0 10px; align-items:center; }
  .bm-row.past{ opacity:.45; }
  .bm-row.today .bm-track{ background:var(--panel2); box-shadow:inset 0 0 0 1px var(--ice-bd); }
  .bm-dl{ font-size:11.5px; font-weight:700; line-height:1.1; }
  .bm-dl small{ display:block; font-size:9px; color:var(--faint); font-family:'JetBrains Mono',monospace; margin-top:1px; }
  .bm-block{ position:absolute; top:4px; bottom:4px; border-radius:7px; border:1px solid; padding:3px 7px; overflow:hidden; }
  .bm-block .bt{ font-size:10.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3; }
  .bm-block .bm2{ font-size:9px; opacity:.7; font-family:'JetBrains Mono',monospace; white-space:nowrap; }
  .bm-block.work{ background:var(--ice-soft); border-color:var(--ice-bd); color:var(--ice); }
  .bm-block.private{ background:var(--teal-soft); border-color:var(--teal-bd); color:var(--teal); }
  .bm-block.rest{ background:transparent; border:1.2px dashed var(--teal); color:var(--teal); }
  .bm-block.now{ border-color:var(--ice); box-shadow:var(--glow); color:var(--ink); background:linear-gradient(180deg, rgba(130,180,232,.28), rgba(130,180,232,.12)); }
  .bm-block.done{ opacity:.4; }
  .bm-block.done .bt{ text-decoration:line-through; }
  .bm-tick{ position:absolute; top:5px; bottom:5px; width:1px; background:var(--line2); }
  .bm-now{ position:absolute; top:-5px; bottom:-5px; width:2px; border-radius:2px; background:var(--ice); box-shadow:var(--glow); z-index:4; }
  .bm-now i{ position:absolute; top:-16px; left:50%; transform:translateX(-50%); font-style:normal; font-size:9px; font-weight:700; color:#0b1118; background:var(--ice); border-radius:5px; padding:1px 6px; font-family:'JetBrains Mono',monospace; }
  .bm-hours{ position:relative; height:13px; }
  .bm-hl{ position:absolute; transform:translateX(-50%); font-size:9px; color:var(--faint); font-family:'JetBrains Mono',monospace; }

  /* command composer */
  .cmd{ display:flex; align-items:center; gap:11px; background:var(--glass); backdrop-filter:blur(10px); border:1px solid var(--line); border-radius:14px; padding:10px 14px; box-shadow:0 12px 40px -12px rgba(0,0,0,.5); }
  .cmd .ph{ flex:1; color:var(--faint); font-size:14px; white-space:nowrap; overflow:hidden; }
  .cmd kbd{ font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); border:1px solid var(--line); border-radius:5px; padding:2px 6px; white-space:nowrap; }
  .pixavatar{ border-radius:50%; overflow:hidden; flex:none; box-shadow:0 0 0 1.5px var(--gold), 0 0 16px rgba(227,182,108,.35); }
  .pixavatar img{ display:block; }

  /* agent status */
  .agent{ display:inline-flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-size:10.5px; color:var(--muted); white-space:nowrap; }
  .agent::before{ content:""; width:7px; height:7px; border-radius:50%; background:var(--teal); box-shadow:0 0 8px var(--teal); animation:stlPulse 3s ease-in-out infinite; }
  @keyframes stlPulse{ 0%,100%{ opacity:1; } 50%{ opacity:.45; } }

  /* nudge card (steel) */
  .snudge{ background:var(--panel2); border:1px solid var(--line); border-left:none; border-radius:14px; padding:12px 14px; position:relative; overflow:hidden; }
  .snudge::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:100%; background:linear-gradient(90deg, var(--ice-soft), transparent 40%); pointer-events:none; }
  .snudge .nl{ font-family:'JetBrains Mono',monospace; font-size:9.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ice); margin-bottom:5px; }
  .snudge .nb{ font-size:13.5px; line-height:1.5; position:relative; }
  .snudge .nf{ font-size:11.5px; color:var(--muted); margin-top:4px; position:relative; }
  .snudge .nacts{ display:flex; gap:7px; margin-top:10px; position:relative; }
  .sact{ font-size:11.5px; font-weight:700; padding:5px 12px; border-radius:8px; cursor:pointer; white-space:nowrap; }
  .sact.pri{ background:var(--ice); color:#0b1118; }
  .sact.sec{ border:1px solid var(--line); color:var(--muted); }

  .vchip{ display:inline-flex; align-items:center; gap:7px; font-family:'JetBrains Mono',monospace; font-size:10.5px; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:9px; padding:5px 10px; cursor:pointer; white-space:nowrap; }
  .vchip b{ color:var(--ink); font-weight:600; }
  .vchip:hover{ border-color:var(--ice-bd); color:var(--ice); }
  .vchip.gold b{ color:var(--gold); }

  @media (prefers-reduced-motion: reduce){ .stl *{ animation:none !important; } }
  `}</style>
);

const bmPct = (h) => ((h - 8) / 11) * 100;

function BmBlock({ b, tall }) {
  const [s, e, title, tag, f = {}] = b;
  const w = bmPct(e) - bmPct(s);
  return (
    <div className={"bm-block " + tag + (f.now ? " now" : "") + (f.done ? " done" : "")}
      style={{ left: bmPct(s) + "%", width: w + "%" }} title={title}>
      {w > 6 && <div className="bt">{f.done && "✓ "}{title}</div>}
      {tall && w > 11 && <div className="bm2">{fmtH(s)}–{fmtH(e)}{f.prot ? " · held" : ""}</div>}
    </div>
  );
}

function BmHours() {
  return (
    <div className="bm-row" style={{ marginBottom: 2 }}>
      <span></span>
      <div className="bm-hours">{[8, 10, 12, 14, 16, 18].map((h) => <span key={h} className="bm-hl" style={{ left: bmPct(h) + "%" }}>{h}:00</span>)}</div>
    </div>
  );
}

/* The beam — horizontal, with Day / Week selector */
function WeekBeam({ defaultMode = "week", compact }) {
  const [mode, setMode] = React.useState(defaultMode);
  const trackH = mode === "day" ? 96 : compact ? 30 : 38;
  const days = mode === "day" ? [DAY_META[1]] : DAY_META;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span className="slabel">{mode === "day" ? "today · tue 9" : "my entire week"} — to scale</span>
        <span className="seg2" style={{ marginLeft: "auto" }}>
          <span className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>Day</span>
          <span className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Week</span>
        </span>
      </div>
      <BmHours />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {days.map((m) => (
          <div key={m.d} className={"bm-row" + (m.today ? " today" : "") + (m.past ? " past" : "")}>
            <div className="bm-dl">{m.d}<small>{m.n} jun</small></div>
            <div className="bm-track" style={{ height: trackH }}>
              {[10, 12, 14, 16, 18].map((h) => <span key={h} className="bm-tick" style={{ left: bmPct(h) + "%" }}></span>)}
              {DAYBLOCKS[m.d].map((b, i) => <BmBlock key={i} b={b} tall={mode === "day"} />)}
              {m.today && <div className="bm-now" style={{ left: bmPct(NOW_H) + "%" }}><i>{fmtH(NOW_H)}</i></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PixAvatar({ size = 28 }) {
  return (
    <span className="pixavatar" style={{ width: size, height: size }}>
      <img src="pixie-poly-face.svg" alt="Pixie" style={{ width: size * 1.4, marginLeft: -size * 0.2, marginTop: -size * 0.3 }} />
    </span>
  );
}

function CmdBar({ placeholder = "Talk to MEW — schedule it, move it, ask it…" }) {
  return (
    <div className="cmd">
      <PixAvatar size={26} />
      <span className="ph">{placeholder}</span>
      <kbd>⌘K</kbd>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: "var(--muted)" }}><rect x="5.5" y="1.5" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/></svg>
    </div>
  );
}

function VitalChips() {
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <span className="vchip gold"><b>5 mews</b> today</span>
      <span className="vchip">plan <b>6.5h</b> / best 5.5</span>
      <span className="vchip">rest <b>4/5</b></span>
      <span className="vchip">carry-over <b>12%</b> ↓</span>
      <span className="vchip" style={{ color: "var(--faint)" }}>+ insights</span>
    </div>
  );
}

function SNudge({ label, body, foot, acts }) {
  return (
    <div className="snudge">
      <div className="nl">{label}</div>
      <div className="nb">{body}</div>
      {foot && <div className="nf">{foot}</div>}
      <div className="nacts">{acts.map((a, i) => <span key={a} className={"sact " + (i === 0 ? "pri" : "sec")}>{a}</span>)}</div>
    </div>
  );
}

Object.assign(window, { StlStyles, WeekBeam, CmdBar, PixAvatar, VitalChips, SNudge, bmPct, BmBlock, BmHours });
