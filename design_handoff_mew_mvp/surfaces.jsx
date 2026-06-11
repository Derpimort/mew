// surfaces.jsx — three MEW main-page surfaces to evaluate.
// Shared warm design language + SurfaceCalm / SurfaceDesk / SurfaceDock.
// Pixie comes from pixie.jsx (loaded first). Exports to window.

const SurfaceStyles = () => (
  <style>{`
  .mew{
    --bg:#f4efe7; --panel:#fbf7ef; --panel2:#fffdf8; --ink:#2b2620; --muted:#8c7e6b;
    --faint:#b6a892; --line:#e8ddca; --line2:#f0e8d9;
    --gold:#c98a3c; --gold-soft:#f0dcb8; --sage:#7f9a6f; --sage-soft:#e2ead9; --rose:#cf8d7e;
    --shadow: 0 1px 2px rgba(74,57,30,.05), 0 14px 38px -18px rgba(74,57,30,.22);
    font-family:'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif;
    box-sizing:border-box;
    color:var(--ink); background:var(--bg); position:relative; overflow:hidden;
    -webkit-font-smoothing:antialiased; letter-spacing:-0.005em;
  }
  .mew--dark{
    --bg:#1d1813; --panel:#262019; --panel2:#2c251d; --ink:#f1e8d8; --muted:#a99a83;
    --faint:#7b6e5b; --line:#39301f; --line2:#322a1d; --gold:#e0a85c; --gold-soft:#3a2f1d;
    --sage:#9fb78e; --sage-soft:#2a3320; --rose:#dca08f;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 20px 50px -22px rgba(0,0,0,.6);
  }
  .mew *{ box-sizing:border-box; }
  .mew .serif{ font-family:'Newsreader', Georgia, serif; }
  .mew .topbar{ display:flex; align-items:center; gap:14px; padding:18px 26px; border-bottom:1px solid var(--line2); }
  .mew .wordmark{ font-weight:800; font-size:19px; letter-spacing:.26em; }
  .mew .wordmark b{ color:var(--gold); }
  .mew .topdate{ color:var(--muted); font-size:14px; }
  .mew .topright{ margin-left:auto; display:flex; align-items:center; gap:18px; color:var(--muted); font-size:14px; white-space:nowrap; }
  .mew .pillstat{ display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:999px; background:var(--panel); border:1px solid var(--line); font-size:13px; font-weight:600; color:var(--ink); white-space:nowrap; }
  .mew .dot{ width:8px; height:8px; border-radius:50%; }

  /* generic task row */
  .mew .task{ display:flex; align-items:center; gap:13px; padding:12px 14px; border-radius:14px; transition:background .2s; }
  .mew .task:hover{ background:var(--panel); }
  .mew .check{ width:20px; height:20px; border-radius:7px; border:1.8px solid var(--faint); flex:none; display:grid; place-items:center; }
  .mew .check.on{ background:var(--sage); border-color:var(--sage); }
  .mew .task .ttime{ width:54px; flex:none; color:var(--muted); font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; }
  .mew .task .ttitle{ font-size:15px; font-weight:600; line-height:1.25; }
  .mew .task.done .ttitle{ color:var(--faint); text-decoration:line-through; text-decoration-color:var(--line); }
  .mew .tag{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; padding:3px 8px; border-radius:7px; }
  .mew .tag.work{ background:var(--gold-soft); color:#8a5a18; }
  .mew .tag.private{ background:var(--sage-soft); color:#4d6340; }
  .mew--dark .tag.work{ color:#e7bd7c; } .mew--dark .tag.private{ color:#b6c9a4; }
  .mew .now-chip{ margin-left:auto; font-size:11px; font-weight:800; letter-spacing:.06em; color:var(--gold); text-transform:uppercase; }

  /* chat */
  .mew .bubble{ max-width:84%; padding:11px 15px; border-radius:16px; font-size:14.5px; line-height:1.5; }
  .mew .bubble.me{ margin-left:auto; background:var(--gold); color:#fff; border-bottom-right-radius:5px; }
  .mew--dark .bubble.me{ color:#231a0d; }
  .mew .bubble.mew{ background:var(--panel); border:1px solid var(--line); border-bottom-left-radius:5px; }
  .mew .composer{ display:flex; align-items:center; gap:10px; padding:11px 12px 11px 18px; border-radius:999px; background:var(--panel2); border:1px solid var(--line); box-shadow:var(--shadow); }
  .mew .composer input{ flex:1; border:0; background:transparent; font:inherit; font-size:15px; color:var(--ink); outline:none; }
  .mew .composer input::placeholder{ color:var(--faint); }
  .mew .send{ width:36px; height:36px; flex:none; border-radius:50%; background:var(--gold); display:grid; place-items:center; }
  .mew .card{ background:var(--panel); border:1px solid var(--line); border-radius:20px; }
  .mew .label{ font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); }
  `}</style>
);

const Check = ({ on }) => (
  <span className={"check" + (on ? " on" : "")}>{on && (
    <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6.5l2.6 2.6L10 3.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  )}</span>
);
const SendIcon = () => (<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h10M8 3l5 5-5 5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);

const TaskRow = ({ t }) => (
  <div className={"task" + (t.done ? " done" : "")}>
    <Check on={t.done} />
    {t.time && <span className="ttime">{t.time}</span>}
    <span className="ttitle">{t.title}</span>
    {t.tag && <span className={"tag " + t.tag}>{t.tag}</span>}
    {t.now && <span className="now-chip">now</span>}
  </div>
);

const TODAY = [
  { time: "9:00", title: "Q3 deck — deep work", tag: "work", now: true },
  { time: "11:30", title: "Team standup", tag: "work" },
  { time: "13:00", title: "Lunch, away from screen", tag: "private", done: true },
  { time: "14:30", title: "Reply to Sam", tag: "work" },
  { time: "16:00", title: "Walk", tag: "private" },
];

/* ────────────────────────────────────────────────────────────────────────
   SURFACE A — CALM HERO.  Pixie centered; the "now" is her quiet thought.
   ──────────────────────────────────────────────────────────────────────── */
function SurfaceCalm() {
  return (
    <div className="mew" style={{ width: 1200, height: 800, display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <span className="wordmark">MEW</span>
        <span className="topdate">Tuesday, June 9</span>
        <div className="topright">
          <span className="pillstat"><span className="dot" style={{ background: "var(--sage)" }}></span>4 mews today</span>
          <span>mewing away</span>
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr", placeItems: "center", position: "relative" }}>
        {/* soft halo */}
        <div style={{ position: "absolute", width: 620, height: 620, borderRadius: "50%", background: "radial-gradient(circle, rgba(201,138,60,.10), transparent 62%)" }}></div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 1, marginTop: -20 }}>
          <div className="card" style={{ padding: "16px 26px", borderRadius: 22, marginBottom: 6, background: "var(--panel2)", boxShadow: "var(--shadow)", maxWidth: 520, textAlign: "center", position: "relative" }}>
            <div className="label" style={{ marginBottom: 8 }}>right now</div>
            <div className="serif" style={{ fontSize: 27, lineHeight: 1.25, fontWeight: 500 }}>Finish the Q3 deck.</div>
            <div style={{ color: "var(--muted)", fontSize: 15, marginTop: 6 }}>40 minutes left in this block · protected until 11:30</div>
            <div style={{ position: "absolute", bottom: -9, left: "50%", width: 18, height: 18, background: "var(--panel2)", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)", transform: "translateX(-50%) rotate(45deg)" }}></div>
          </div>
          <PixieCat mood="healthy" size={232} />
        </div>

        {/* ambient today strip */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 96, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: "0 60px", opacity: .96 }}>
          {TODAY.map((t, i) => (
            <span key={i} className="pillstat" style={{ background: t.now ? "var(--gold-soft)" : "var(--panel)", borderColor: t.now ? "transparent" : "var(--line)", color: t.done ? "var(--faint)" : "var(--ink)", textDecoration: t.done ? "line-through" : "none", textDecorationColor: "var(--line)" }}>
              <span style={{ color: "var(--muted)", fontWeight: 700 }}>{t.time}</span>{t.title}
            </span>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 220px 26px" }}>
        <div className="composer">
          <span style={{ color: "var(--faint)", fontSize: 15 }}>Talk to MEW</span>
          <input placeholder="— move something, add a block, or just check in…" readOnly />
          <span className="send"><SendIcon /></span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   SURFACE B — THE DESK.  Balanced: week rail · big now + Pixie · chat.
   ──────────────────────────────────────────────────────────────────────── */
function SurfaceDesk() {
  return (
    <div className="mew" style={{ width: 1200, height: 800, display: "grid", gridTemplateRows: "auto 1fr", }}>
      <div className="topbar">
        <span className="wordmark">MEW</span>
        <span className="topdate">Tuesday, June 9 · week 24</span>
        <div className="topright"><span className="pillstat"><span className="dot" style={{ background: "var(--sage)" }}></span>healthy</span></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr 340px", minHeight: 0 }}>
        {/* LEFT — today's blocks */}
        <div style={{ borderRight: "1px solid var(--line2)", padding: "22px 16px", overflow: "hidden" }}>
          <div className="label" style={{ padding: "0 10px 10px" }}>Today</div>
          {TODAY.map((t, i) => <TaskRow key={i} t={t} />)}
          <div className="task" style={{ color: "var(--faint)", paddingTop: 16 }}>
            <span className="check" style={{ borderStyle: "dashed", borderColor: "var(--line)" }}></span>
            <span className="ttime">18:00</span><span className="ttitle" style={{ color: "var(--sage)", fontWeight: 700 }}>Rest — earned</span>
          </div>
        </div>

        {/* CENTER — the now + Pixie */}
        <div style={{ padding: "34px 28px 26px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          <div style={{ textAlign: "center", maxWidth: 500 }}>
            <div className="label" style={{ marginBottom: 12 }}>right now</div>
            <div className="serif" style={{ fontSize: 35, lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>Finish the Q3 deck.</div>
            <div style={{ color: "var(--muted)", fontSize: 16, marginTop: 12 }}>40 min left in this block · 4 mews made today</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 18 }}>
              {[1, 1, 1, 1, 0, 0, 0].map((on, i) => (
                <span key={i} style={{ width: 30, height: 6, borderRadius: 3, background: on ? "var(--sage)" : "var(--line)" }}></span>
              ))}
            </div>
          </div>
          {/* Pixie on a shelf */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <PixieCat mood="healthy" size={196} />
            <div style={{ width: 230, height: 12, borderRadius: 999, background: "radial-gradient(ellipse, rgba(74,57,30,.10), transparent 70%)", marginTop: -6 }}></div>
          </div>
        </div>

        {/* RIGHT — chat */}
        <div style={{ borderLeft: "1px solid var(--line2)", display: "flex", flexDirection: "column", background: "var(--panel)" }}>
          <div className="label" style={{ padding: "20px 22px 4px" }}>MEW</div>
          <div style={{ flex: 1, padding: "12px 18px", display: "flex", flexDirection: "column", gap: 12, justifyContent: "flex-end" }}>
            <div className="bubble me">block thursday morning for the deck, keep friday afternoon free</div>
            <div className="bubble mew">Done — Thursday 9–12 is held for the deck, Friday afternoon kept free.<br /><span style={{ color: "var(--muted)" }}>That's your 3rd deep-work block this week.</span></div>
            <div className="bubble mew">Quick check — you've planned 9h of deep work tomorrow; your realistic best has been ~5½. Want me to right-size it?</div>
          </div>
          <div style={{ padding: "12px 16px 18px" }}>
            <div className="composer"><input placeholder="Talk to MEW…" readOnly /><span className="send"><SendIcon /></span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   SURFACE C — COMPANION DOCK (dark).  Agenda leads; Pixie lives in a dock.
   ──────────────────────────────────────────────────────────────────────── */
function SurfaceDock() {
  return (
    <div className="mew mew--dark" style={{ width: 1200, height: 800, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div className="topbar" style={{ borderColor: "var(--line)" }}>
        <span className="wordmark">MEW</span>
        <span className="topdate">Tuesday, June 9</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 999, padding: "8px 16px 8px 8px" }}>
          <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--gold-soft)", display: "grid", placeItems: "center", overflow: "hidden" }}>
            <span style={{ transform: "scale(1.7) translateY(3px)", display: "block" }}><PixieCat mood="healthy" size={26} /></span>
          </span>
          <span style={{ fontSize: 14 }}><b style={{ fontWeight: 700 }}>Right now</b> · Q3 deck, 40 min left</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", minHeight: 0 }}>
        {/* agenda */}
        <div style={{ padding: "30px 46px", overflow: "hidden" }}>
          <div className="serif" style={{ fontSize: 30, fontWeight: 500, marginBottom: 4 }}>Your week, in hand.</div>
          <div style={{ color: "var(--muted)", fontSize: 15, marginBottom: 22 }}>Five blocks today · two protected · nothing overdue.</div>
          <div className="card" style={{ padding: 12, maxWidth: 640 }}>
            {TODAY.map((t, i) => <TaskRow key={i} t={t} />)}
            <div className="task">
              <span className="check" style={{ borderStyle: "dashed", borderColor: "var(--line)" }}></span>
              <span className="ttime">18:00</span><span className="ttitle" style={{ color: "var(--sage)", fontWeight: 700 }}>Rest — earned</span>
            </div>
          </div>
        </div>

        {/* Pixie dock */}
        <div style={{ borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 22, position: "relative" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "radial-gradient(circle at 50% 38%, rgba(224,168,92,.12), transparent 60%)" }}></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 1, marginBottom: 14 }}>
            <PixieCat mood="healthy" size={210} />
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ background: "var(--sage)" }}></span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Pixie is healthy</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4, textAlign: "center", maxWidth: 250 }}>A sustainable week. Keep mewing — rest is on the calendar.</div>
          </div>
          <div className="composer" style={{ zIndex: 1, background: "var(--panel2)" }}>
            <input placeholder="Talk to MEW…" readOnly /><span className="send"><SendIcon /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SurfaceStyles, SurfaceCalm, SurfaceDesk, SurfaceDock, TaskRow, Check, SendIcon, TODAY });
