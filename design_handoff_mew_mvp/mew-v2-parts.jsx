// mew-v2-parts.jsx — the synthesis: whole week visible, today in focus.
// Reuses SurfaceStyles + TaskRow/SendIcon/TODAY from surfaces.jsx.
// PixiePoly = the photoreal low-poly Pixie (pixie-poly-face.svg) as companion.

const WeekStyles = () => (
  <style>{`
  @keyframes pixiePolyBreathe{ 0%,100%{ transform:scale(1) translateY(0);} 50%{ transform:scale(1.015) translateY(-1px);} }
  .pixie-poly{ position:relative; box-shadow: inset 0 -22px 40px -20px rgba(60,32,8,.5), inset 0 2px 0 rgba(255,255,255,.18); }
  .pixie-poly::after{ content:""; position:absolute; inset:0; border-radius:inherit; box-shadow: inset 0 0 0 1px rgba(120,80,30,.12); pointer-events:none; }
  @media (prefers-reduced-motion: reduce){ .pixie-poly img{ animation:none !important; } }

  .wk-day{ display:grid; grid-template-columns:42px 1fr 30px; align-items:center; gap:12px; padding:9px 11px; border-radius:13px; }
  .wk-day.today{ background:var(--panel2); box-shadow: inset 0 0 0 1.6px var(--gold); }
  .wk-day.past{ opacity:.5; }
  .wk-dlabel{ font-weight:700; font-size:13px; line-height:1.05; }
  .wk-dlabel small{ display:block; color:var(--muted); font-weight:600; font-size:10.5px; margin-top:1px; }
  .wk-bar{ height:10px; border-radius:999px; background:var(--line); overflow:hidden; display:flex; }
  .wk-seg{ height:100%; }
  .wk-h{ font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; text-align:right; font-weight:600; }
  .wk-day.today .wk-h{ color:var(--gold); }
  .nowcard{ background:var(--panel2); border:1px solid var(--line); border-radius:22px; box-shadow:var(--shadow); padding:24px 28px; }
  .tl-row{ display:grid; grid-template-columns:54px 1fr; gap:14px; align-items:flex-start; }
  .tl-time{ color:var(--muted); font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; padding-top:11px; }
  .tl-dot{ position:relative; }
  .tl-block{ flex:1; border-radius:13px; padding:11px 14px; border:1px solid var(--line); background:var(--panel); display:flex; align-items:center; gap:10px; }
  .tl-block.now{ background:var(--gold-soft); border-color:transparent; }
  .tl-block.done{ opacity:.55; }
  .nowline{ display:flex; align-items:center; gap:10px; margin:3px 0 3px 68px; color:var(--gold); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
  .nowline::before{ content:""; width:8px; height:8px; border-radius:50%; background:var(--gold); }
  .nowline::after{ content:""; flex:1; height:1.5px; background:linear-gradient(90deg,var(--gold),transparent); }
  `}</style>
);

function PixiePoly({ mood = "healthy", size = 168, radius = 22, style, className = "" }) {
  const filt = mood === "rundown" ? "saturate(.6) brightness(.95) contrast(.98) grayscale(.08)"
    : mood === "resting" ? "brightness(.96) saturate(.88)" : "none";
  return (
    <div className={"pixie-poly " + className} style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", ...style }}>
      <img src="pixie-poly-face.svg" alt="Pixie" draggable="false"
        style={{ width: "100%", height: "auto", display: "block", filter: filt, transformOrigin: "50% 62%", animation: "pixiePolyBreathe 6.2s ease-in-out infinite" }} />
    </div>
  );
}

const WEEK = [
  { d: "Mon", n: 8, work: 6, priv: 2, past: true },
  { d: "Tue", n: 9, work: 5.5, priv: 1.5, rest: 1, today: true },
  { d: "Wed", n: 10, work: 8, priv: 0.5 },
  { d: "Thu", n: 11, work: 6, priv: 1.5 },
  { d: "Fri", n: 12, work: 3, priv: 1.5 },
  { d: "Sat", n: 13, priv: 2.5 },
  { d: "Sun", n: 14, rest: 2 },
];
const MAX = 10;
const SEGC = { work: "var(--gold)", priv: "var(--sage)", rest: "#d8c094" };

function WeekRow({ day }) {
  const total = (day.work || 0) + (day.priv || 0) + (day.rest || 0);
  return (
    <div className={"wk-day" + (day.today ? " today" : "") + (day.past ? " past" : "")}>
      <div className="wk-dlabel">{day.d}<small>Jun {day.n}</small></div>
      <div className="wk-bar">
        {["work", "priv", "rest"].map((k) => day[k] ? (
          <span key={k} className="wk-seg" style={{ width: (day[k] / MAX * 100) + "%", background: SEGC[k] }}></span>
        ) : null)}
      </div>
      <div className="wk-h">{total % 1 ? total : total}h</div>
    </div>
  );
}

function SurfaceWeek() {
  return (
    <div className="mew" style={{ width: 1280, height: 840, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div className="topbar">
        <span className="wordmark">MEW</span>
        <span className="topdate">Tuesday, June 9 · week 24</span>
        <div className="topright">
          <span className="pillstat" style={{ paddingLeft: 6 }}>
            <span style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", display: "block" }}>
              <img src="pixie-poly-face.svg" alt="" style={{ width: 34, marginLeft: -5, marginTop: -3 }} />
            </span>
            <span className="dot" style={{ background: "var(--sage)" }}></span>Pixie · healthy
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "312px 1fr 384px", minHeight: 0 }}>
        {/* LEFT — my entire week */}
        <div style={{ borderRight: "1px solid var(--line2)", padding: "20px 14px", display: "flex", flexDirection: "column" }}>
          <div className="label" style={{ padding: "0 8px 12px" }}>My entire week</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {WEEK.map((d) => <WeekRow key={d.d} day={d} />)}
          </div>
          {/* legend */}
          <div style={{ display: "flex", gap: 14, padding: "14px 10px 4px", fontSize: 12, color: "var(--muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--gold)" }}></span>work</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--sage)" }}></span>private</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "#d8c094" }}></span>rest</span>
          </div>
          {/* week-shaped nudge */}
          <div style={{ marginTop: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.45 }}>
            <span style={{ color: "var(--gold)", fontWeight: 700 }}>Wednesday looks heavy.</span> <span style={{ color: "var(--muted)" }}>8h of deep work — your best is ~5½. Want me to spread it?</span>
          </div>
        </div>

        {/* CENTER — today, in focus */}
        <div style={{ padding: "26px 36px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="nowcard">
            <div className="label" style={{ marginBottom: 8 }}>right now</div>
            <div className="serif" style={{ fontSize: 38, lineHeight: 1.08, fontWeight: 500, letterSpacing: "-0.02em" }}>Finish the Q3 deck.</div>
            <div style={{ color: "var(--muted)", fontSize: 15.5, marginTop: 10 }}>40 min left in this block · protected until 11:30 · 4 mews today</div>
            <div style={{ display: "flex", gap: 5, marginTop: 16 }}>
              {[1, 1, 1, 1, 0, 0, 0].map((on, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: on ? "var(--sage)" : "var(--line)" }}></span>)}
            </div>
          </div>

          <div className="label" style={{ margin: "26px 2px 14px" }}>Today · Tuesday</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <Tl time="9:00" title="Q3 deck — deep work" tag="work" now />
            <div className="nowline"><span style={{ whiteSpace: "nowrap" }}>now · 9:40</span></div>
            <Tl time="11:30" title="Team standup" tag="work" />
            <Tl time="13:00" title="Lunch, away from screen" tag="private" done />
            <Tl time="14:30" title="Reply to Sam" tag="work" />
            <Tl time="16:00" title="Walk" tag="private" />
            <Tl time="18:00" title="Rest — earned" rest />
          </div>
        </div>

        {/* RIGHT — Pixie + chat */}
        <div style={{ borderLeft: "1px solid var(--line2)", display: "flex", flexDirection: "column", background: "var(--panel)" }}>
          <div style={{ padding: "18px 20px 14px", display: "flex", gap: 15, alignItems: "center", borderBottom: "1px solid var(--line2)" }}>
            <PixiePoly mood="healthy" size={88} radius={18} style={{ flex: "none" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Pixie</div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, whiteSpace: "nowrap" }}>
                <span className="dot" style={{ background: "var(--sage)" }}></span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>healthy · mewing away</span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6, lineHeight: 1.4 }}>A pace you can keep.<br />Rest is on the calendar.</div>
            </div>
          </div>
          <div style={{ flex: 1, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 11, justifyContent: "flex-end" }}>
            <div className="bubble me">block thursday morning for the deck, keep friday afternoon free</div>
            <div className="bubble mew">Done — Thursday 9–12 is held, Friday afternoon kept free.<br /><span style={{ color: "var(--muted)" }}>That's your 3rd deep-work block this week.</span></div>
            <div className="bubble mew">Still on the deck, or should I move it?</div>
          </div>
          <div style={{ padding: "10px 14px 16px" }}>
            <div className="composer"><input placeholder="Talk to MEW…" readOnly /><span className="send"><SendIcon /></span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tl({ time, title, tag, now, done, rest }) {
  return (
    <div className="tl-row">
      <div className="tl-time">{time}</div>
      <div className={"tl-block" + (now ? " now" : "") + (done ? " done" : "")}>
        <span className={"check" + (done ? " on" : "")} style={rest ? { borderStyle: "dashed" } : {}}>
          {done && <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6.5l2.6 2.6L10 3.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", color: rest ? "var(--sage)" : "inherit" }}>{title}</span>
        {tag && <span className={"tag " + tag} style={{ marginLeft: "auto" }}>{tag}</span>}
        {now && <span className="now-chip" style={{ marginLeft: tag ? 8 : "auto" }}>now</span>}
      </div>
    </div>
  );
}

Object.assign(window, { WeekStyles, PixiePoly, SurfaceWeek, WeekRow, Tl, WEEK });
